document.querySelectorAll("[data-include]").forEach(async function (el) {
    try {
        const response = await fetch(el.dataset.include);
        if (!response.ok) throw new Error(response.status);
        el.outerHTML = await response.text();
    } catch (error) {
        console.error("Could not load " + el.dataset.include, error);
    }
});