const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("sidebar-overlay");
const btnMenu = document.getElementById("btn-menu");

function openSidebar() {
    sidebar.classList.remove("-translate-x-full");
    overlay.classList.remove("opacity-0", "pointer-events-none");
}

function closeSidebar() {
    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("opacity-0", "pointer-events-none");
}

btnMenu?.addEventListener("click", openSidebar);
overlay?.addEventListener("click", closeSidebar);

/* cerrar al tocar link */

document.querySelectorAll("#sidebar a, #sidebar div").forEach(el => {
    el.addEventListener("click", () => {
        if (window.innerWidth < 1024) {
            closeSidebar();
        }
    })
})