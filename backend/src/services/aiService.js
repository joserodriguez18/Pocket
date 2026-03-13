// src/services/aiService.js
import OpenAI from "openai";
import { pool } from "../config/db.js";
import { AppError } from "../errors/AppError.js";
import { summaryService } from "./summaryService.js";
import { goalService } from "./goalService.js";
import { categoryService } from "./categoryService.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_TOKENS = 2048;
const HISTORY_LIMIT = 10;

// ─── Contexto financiero ──────────────────────────────────────────────────────

const loadFinancialContext = async (userId) => {
  const now = new Date();
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // Reusar servicios existentes en lugar de SQL directo
  const [summary, goals, categories] = await Promise.all([
    summaryService.getSummary(userId, {}),
    goalService.list(userId),
    categoryService.list(userId),
  ]);

  const [recent] = await pool.execute(
    `SELECT t.type, t.amount, t.description, t.date, c.name AS category
     FROM transactions t
     JOIN categories c ON t.category_id = c.id
     WHERE t.user_id = ?
     ORDER BY t.date DESC, t.created_at DESC LIMIT 20`,
    [userId]
  );

  const [historialMensual] = await pool.execute(
    `SELECT DATE_FORMAT(date, '%Y-%m') AS mes,
            COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0)  AS ingresos,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0) AS gastos
     FROM transactions
     WHERE user_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
     GROUP BY DATE_FORMAT(date, '%Y-%m')
     ORDER BY mes DESC`,
    [userId]
  );

  return {
    summary,
    goals,
    categories,
    recent,
    historialMensual,
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    date: now.toLocaleDateString('es-CO'),
  };
};

// ─── System prompt ────────────────────────────────────────────────────────────

const buildSystemPrompt = (ctx) => {
  const fmtCOP = n => '$' + Math.abs(Number(n)).toLocaleString('es-CO');
  const { totals } = ctx.summary;

  const categoryList = ctx.categories
    .map(c => `  id:${c.id} | ${c.name} [${c.type}]`)
    .join('\n') || '  (sin categorías)';

  const recentList = ctx.recent
    .map(t =>
      `  [${t.date?.toString().slice(0, 10)}] ${t.type === 'income' ? '↑' : '↓'} ` +
      `${fmtCOP(t.amount)} — ${t.category}${t.description ? ` — ${t.description}` : ''}`
    ).join('\n') || '  (sin transacciones)';

  const goalsList = ctx.goals
    .map(g =>
      `  • "${g.title}" — ahorrado: ${fmtCOP(g.current_amount)} / meta: ${fmtCOP(g.target_amount)} ` +
      `(${Math.round(g.current_amount / g.target_amount * 100)}%) ${g.is_completed ? '✅ COMPLETADA' : '🔄 activa'}`
    ).join('\n') || '  (sin metas)';

  const historialList = ctx.historialMensual
    .map(m => `  ${m.mes}: ingresos ${fmtCOP(m.ingresos)} / gastos ${fmtCOP(m.gastos)}`)
    .join('\n') || '  (sin historial)';

  return `Eres NOVA, asistente financiero personal integrado en PocketPal. Respondes en español colombiano, eres preciso y amigable.

FECHA ACTUAL: ${ctx.date} | MES: ${ctx.month}

MES ACTUAL:
- Total ingresos: ${fmtCOP(totals.total_income)}
- Total gastos:   ${fmtCOP(totals.total_expenses)}
- Balance:        ${fmtCOP(totals.net_balance)}

CATEGORÍAS DISPONIBLES:
${categoryList}

ÚLTIMAS TRANSACCIONES:
${recentList}

HISTORIAL MENSUAL (últimos 6 meses):
${historialList}

METAS DE AHORRO:
${goalsList}

REGLAS:
- Responde siempre en español colombiano
- Usa los nombres de categoría EXACTOS del listado de arriba
- "gasté/pagué/compré" → expense | "recibí/cobré/ingresé" → income
- Si faltan datos para registrar (monto o categoría), pídelos antes de usar una función
- Para estadísticas usa las funciones disponibles — nunca inventes números
- Si gastos > ingresos del mes, menciónalo con tacto al dar consejos
- Usa emojis con moderación`;
};

// ─── Tools (igual que antes) ──────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_transaction',
      description: 'Registra una nueva transacción (ingreso o gasto)',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          transaction_type: { type: 'string', enum: ['income', 'expense'] },
          category_name: { type: 'string' },
          description: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['amount', 'transaction_type', 'category_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_stats',
      description: 'Consulta estadísticas financieras del usuario',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['week', 'month', 'year', 'all'] },
        },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_transactions',
      description: 'Lista las últimas transacciones',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          type: { type: 'string', enum: ['income', 'expense'] },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'goals_status',
      description: 'Estado actual de todas las metas de ahorro',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_goal',
      description: 'Crea una nueva meta de ahorro',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          target_amount: { type: 'number' },
        },
        required: ['title', 'target_amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'allocate_to_goal',
      description: 'Abona dinero a una meta de ahorro existente',
      parameters: {
        type: 'object',
        properties: {
          goal_name: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['goal_name', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_goal',
      description: 'Actualiza el nombre o el monto de la meta, no puede ser menor a lo que ya está abonado',
      parameters: {
        type: 'object',
        properties: {
          goal_id: { type: 'number', description: 'ID de la meta' },
          goal_name: { type: 'string', description: 'Nombre de la meta a buscar' },
          title: { type: 'string', description: 'Nuevo título' },
          target_amount: { type: 'number', description: 'Nuevo monto objetivo' },
        },
        required: [],
      },
    },
  },
];

// ─── Ejecutores — consumen servicios existentes ───────────────────────────────

const toolExecutors = {

  async create_transaction(userId, { amount, transaction_type, category_name, description, date }) {
    const [cats] = await pool.execute(
      'SELECT id, name FROM categories WHERE (user_id IS NULL OR user_id = ?) AND name LIKE ? LIMIT 1',
      [userId, `%${category_name}%`]
    );

    if (cats.length === 0)
      return { success: false, message: `No encontré la categoría "${category_name}". Usa un nombre del listado.` };

    const txDate = date || new Date().toISOString().split('T')[0];
    const [result] = await pool.execute(
      'INSERT INTO transactions (user_id, type, amount, category_id, description, date) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, transaction_type, parseFloat(amount), cats[0].id, description || null, txDate]
    );

    const [[tx]] = await pool.execute(
      'SELECT id, type, amount, description, date FROM transactions WHERE id = ?',
      [result.insertId]
    );

    return { success: true, actionType: 'TRANSACTION_CREATED', transaction: { ...tx, category: cats[0].name } };
  },

  async query_stats(userId, { period }) {
    // Reusar summaryService
    const filters = {};
    if (period === 'month') {
      const now = new Date();
      filters.start_date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (period === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      filters.start_date = d.toISOString().split('T')[0];
    } else if (period === 'year') {
      filters.start_date = `${new Date().getFullYear()}-01-01`;
    }

    const data = await summaryService.getSummary(userId, filters);
    return { success: true, actionType: 'STATS_RESULT', ...data, period };
  },

  async list_transactions(userId, { limit = 10, type } = {}) {
    const safeLimit = Math.min(20, Math.max(1, parseInt(limit) || 10));
    const params = [userId];
    let typeFilter = '';

    if (type) { typeFilter = 'AND t.type = ?'; params.push(type); }

    const [rows] = await pool.execute(
      `SELECT t.id, t.type, t.amount, t.description, t.date, c.name AS category
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = ? ${typeFilter}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT ${safeLimit}`,
      params
    );

    return { success: true, actionType: 'TRANSACTIONS_LIST', transactions: rows };
  },

  async goals_status(userId) {
    // Reusar goalService
    const goals = await goalService.list(userId);
    return { success: true, actionType: 'GOALS_STATUS', goals };
  },

  async create_goal(userId, { title, target_amount }) {
    // Reusar goalService
    const goal = await goalService.create(userId, { title, target_amount });
    return { success: true, actionType: 'GOAL_CREATED', goal };
  },

  async allocate_to_goal(userId, { goal_name, amount }) {
    // Buscar meta por nombre
    const [rows] = await pool.execute(
      'SELECT id FROM goals WHERE user_id = ? AND LOWER(title) LIKE LOWER(?) LIMIT 1',
      [userId, `%${goal_name}%`]
    );

    if (rows.length === 0)
      return { success: false, message: `No encontré la meta "${goal_name}"` };

    // Reusar goalService
    const result = await goalService.allocate(rows[0].id, userId, amount);
    return { success: true, actionType: 'GOAL_ALLOCATED', ...result };
  },
  async update_goal(userId, { goal_id, goal_name, title, target_amount } = {}) {
    // Buscar meta por id o por nombre
    let current;

    if (goal_id) {
      const [[row]] = await pool.execute(
        'SELECT id, title, target_amount FROM goals WHERE id = ? AND user_id = ?',
        [goal_id, userId]
      );
      current = row;
    } else if (goal_name) {
      const [[row]] = await pool.execute(
        'SELECT id, title, target_amount FROM goals WHERE user_id = ? AND LOWER(title) LIKE LOWER(?) LIMIT 1',
        [userId, `%${goal_name}%`]
      );
      current = row;
    }

    if (current.length === 0)
      return { success: false, message: `No encontré la meta "${title}"` };

    // Usar valores actuales si no se envían nuevos
    const result = await goalService.update(userId, goal_id, {
      title: title ?? current.title,
      target_amount: target_amount ?? current.target_amount,
    });

    return { success: true, actionType: 'GOAL_UPDATED', goal: result };
  },
  // async update_goal(userId, { goal_name, amount }) {
  //   // Buscar meta por nombre
  //   const [rows] = await pool.execute(
  //     'SELECT id FROM goals WHERE user_id = ? AND LOWER(title) LIKE LOWER(?) LIMIT 1',
  //     [userId, `%${goal_name}%`]
  //   );

  //   if (rows.length === 0)
  //     return { success: false, message: `No encontré la meta "${goal_name}"` };

  //   // Reusar goalService
  //   const result = await goalService.update(rows[0].id, userId, {goal_name, amount});
  //   return { success: true, actionType: 'GOAL_UPDATE', ...result };
  // },
};

// ─── Servicio público (igual que antes) ───────────────────────────────────────

const aiService = {

  async chat(userId, message, history = []) {
    await pool.execute(
      "INSERT INTO ai_chat_history (user_id, role, content) VALUES (?, 'user', ?)",
      [userId, message]
    );

    const ctx = await loadFinancialContext(userId);
    const systemPrompt = buildSystemPrompt(ctx);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    let finalText = '';
    let actionResult = null;

    try {
      const firstResponse = await openai.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        tools: TOOLS,
        tool_choice: 'auto',
        messages,
      });

      const assistantMessage = firstResponse.choices[0].message;

      if (assistantMessage.tool_calls?.length > 0) {
        const toolCall = assistantMessage.tool_calls[0];
        const funcName = toolCall.function.name;

        let funcArgs = {};
        try { funcArgs = JSON.parse(toolCall.function.arguments); } catch { funcArgs = {}; }

        const executor = toolExecutors[funcName];
        actionResult = executor
          ? await executor(userId, funcArgs)
          : { success: false, message: `Función "${funcName}" no disponible` };

        const secondResponse = await openai.chat.completions.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          tools: TOOLS,
          messages: [
            ...messages,
            assistantMessage,
            { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(actionResult) },
          ],
        });

        finalText = secondResponse.choices[0].message.content || '';
      } else {
        finalText = assistantMessage.content || '';
      }

    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        throw new AppError(`Error del agente IA: ${err.message}`, 502, 'AI_UNAVAILABLE');
      }
      throw err;
    }

    await pool.execute(
      "INSERT INTO ai_chat_history (user_id, role, content) VALUES (?, 'assistant', ?)",
      [userId, finalText]
    );

    return { message: finalText, actionResult };
  },

  async getHistory(userId) {
    const [rows] = await pool.execute(
      'SELECT role, content, created_at FROM ai_chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
    return rows.reverse();
  },

  async clearHistory(userId) {
    await pool.execute('DELETE FROM ai_chat_history WHERE user_id = ?', [userId]);
  },
};

export default aiService;