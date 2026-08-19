chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getSelectedText") {
        // Capturar y limpiar el texto principal de la página (primeros 2000 caracteres limpios)
        const textoLimpio = document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 2000);
        const textoSeleccionado = window.getSelection().toString().trim();

        // Intentar detectar el autor en la página (puedes ajustar los selectores según el sitio)
        const autorElemento = document.querySelector('meta[name="author"]')?.content || 
                              document.querySelector('.author-name, [data-testid="author-name"]')?.innerText || 
                              '';

        sendResponse({ 
            text: textoSeleccionado || textoLimpio, 
            title: document.title, 
            url: window.location.href,
            author: autorElemento.trim()
        });
    }
    return true; // Mantiene el canal abierto para respuestas asíncronas si lo necesitas
});