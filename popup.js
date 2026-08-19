document.addEventListener("DOMContentLoaded", () => {
    // 1. TRADUCCIÓN SEGURA DE ETIQUETAS __MSG_...__ EN EL POPUP HTML
    const traducirElementos = (elemento) => {
        if (elemento.nodeType === Node.TEXT_NODE) {
            elemento.nodeValue = elemento.nodeValue.replace(/__MSG_(\w+)__/g, (match, p1) => {
                return chrome.i18n.getMessage(p1) || match;
            });
        } else {
            if (elemento.attributes) {
                for (let attr of elemento.attributes) {
                    attr.value = attr.value.replace(/__MSG_(\w+)__/g, (match, p1) => {
                        return chrome.i18n.getMessage(p1) || match;
                    });
                }
            }
            elemento.childNodes.forEach(traducirElementos);
        }
    };
    traducirElementos(document.body);

    // --- FUNCION AUXILIAR PARA LIMPIAR RESULTADOS (UX) ---
    const limpiarResultados = () => {
        const wrapper = document.getElementById('result-wrapper');
        if (wrapper) {
            wrapper.style.display = 'none';
        }
    };

    // --- 1. LÓGICA DE LAS PESTAÑAS ---
    document.getElementById('btnTabResumen').addEventListener('click', () => {
        document.getElementById('btnTabResumen').classList.add('active');
        document.getElementById('btnTabApa').classList.remove('active');
        document.getElementById('panel-resumen').classList.add('active');
        document.getElementById('panel-apa').classList.remove('active');
        limpiarResultados();
    });

    document.getElementById('btnTabApa').addEventListener('click', () => {
        document.getElementById('btnTabApa').classList.add('active');
        document.getElementById('btnTabResumen').classList.remove('active');
        document.getElementById('panel-apa').classList.add('active');
        document.getElementById('panel-resumen').classList.remove('active');
        limpiarResultados();
    });

    // --- 2. MOSTRAR/OCULTAR CAMPO DE CITA SEGÚN TIPO Y LIMPIAR RESULTADOS ---
    document.getElementById('citationType').addEventListener('change', () => {
        const citationType = document.getElementById('citationType').value;
        const containerTextarea = document.getElementById('container-textarea');
        const helperText = document.getElementById('helper-citation');

        if (citationType === 'reference') {
            containerTextarea.style.display = 'none';
            helperText.textContent = "Will be generated automatically using this tab's URL and title.";
        } else {
            containerTextarea.style.display = 'block';
            helperText.textContent = "Select or paste the exact fragment to cite...";
        }
        limpiarResultados();
    });

    // --- CAMBIO DINÁMICO DEL ENLACE DE AYUDA Y FORMATO ---
    const guideLinks = {
        "APA": "https://biblioguias.uam.es/citar/estilo_apa_7th_ed",
        "IEEE": "https://www.scribbr.com/category/ieee/",
        "Vancouver": "https://www.scribbr.com/citing-sources/citation-styles/",
        "Harvard": "https://www.scribbr.com/citing-sources/citation-styles/",
        "MLA": "https://www.scribbr.com/citing-sources/apa-vs-mla/"
    };

    document.getElementById('formatSelect').addEventListener('change', (e) => {
        const selectedFormat = e.target.value;
        const guideLink = document.getElementById('guideLink');
        if (guideLinks[selectedFormat] && guideLink) {
            guideLink.href = guideLinks[selectedFormat];
        }
        limpiarResultados();
    });

    // --- 3. BOTÓN DE RESUMIR (BLINDADO, ROBUSTO Y CON TIMEOUT) ---
    document.getElementById('btnResumir').addEventListener('click', async () => {
        mostrarCarga(true, "Analizando página y generando resumen...");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
                clearTimeout(timeoutId);
                mostrarCarga(false);
                alert('No se puede extraer texto de páginas internas del navegador.');
                return;
            }

            const [{ result: pageContent }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const selectedText = window.getSelection().toString().trim();
                    if (selectedText.length > 0) {
                        return selectedText;
                    }

                    const paragraphs = Array.from(document.querySelectorAll('p'))
                        .map(p => p.innerText.trim())
                        .filter(text => text.length > 30);

                    if (paragraphs.length > 0) {
                        return paragraphs.join('\n\n');
                    }

                    return document.body ? document.body.innerText.trim() : '';
                }
            });

            if (!pageContent || pageContent.length < 10) {
                clearTimeout(timeoutId);
                mostrarCarga(false);
                alert('No se encontró suficiente contenido de texto útil en esta página.');
                return;
            }

            const response = await fetch('http://localhost:3000/api/text_summary', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: pageContent,
                    mode: 'summary',
                    pageTitle: tab.title || 'Sin título',
                    pageUrl: tab.url
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const data = await response.json();
            mostrarCarga(false);
            
            if (response.ok && data.success && data.result) {
                mostrarResultado(data.result, true, 'summary');
            } else {
                mostrarResultado('Atención: ' + (data.error || 'Respuesta inválida del servidor.'), false, 'summary');
            }
        } catch (error) {
            clearTimeout(timeoutId);
            mostrarCarga(false);
            console.error('Error crítico en la extensión:', error);
            if (error.name === 'AbortError') {
                mostrarResultado('El servidor tardó demasiado en responder (Timeout). Intenta de nuevo.', false, 'summary');
            } else {
                mostrarResultado('Ocurrió un error inesperado al conectar con el servidor local.', false, 'summary');
            }
        }
    });

    // --- 4. BOTÓN DE CITAS Y REFERENCIAS ---
    document.getElementById('btnApa').addEventListener('click', async () => {
        const formato = document.getElementById('formatSelect').value;
        const tipo = document.getElementById('citationType').value;
        let textoCita = document.getElementById('textoApa').value.trim();

        mostrarCarga(true, "Generando referencia o cita...");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
                clearTimeout(timeoutId);
                mostrarCarga(false);
                alert('No se puede extraer texto de páginas internas del navegador.');
                return;
            }

            if (tipo === 'in-text' && !textoCita) {
                const injectionResults = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => window.getSelection ? window.getSelection().toString().trim() : ''
                });

                const selectedText = injectionResults && injectionResults[0] ? injectionResults[0].result : '';

                if (selectedText && selectedText.length > 0) {
                    textoCita = selectedText;
                    document.getElementById('textoApa').value = selectedText;
                } else {
                    clearTimeout(timeoutId);
                    mostrarCarga(false);
                    alert("Por favor selecciona texto en la página o escribe el fragmento para la cita.");
                    return;
                }
            }

            const metaInjection = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const authorMeta = document.querySelector('meta[name="author"]')?.content || 
                                       document.querySelector('meta[property="article:author"]')?.content || 
                                       document.querySelector('meta[name="byl"]')?.content || '';
                    
                    const dateMeta = document.querySelector('meta[property="article:published_time"]')?.content || 
                                   document.querySelector('time')?.getAttribute('datetime') || '';

                    const authorSelectors = [
                        '[data-testid="author"]', '.author-name', '.byline', 
                        '.author', '.authors', '[rel="author"]', '.c-byline__author', '.qa-author-name'
                    ];
                    
                    let authorElement = '';
                    for (let selector of authorSelectors) {
                        const el = document.querySelector(selector);
                        if (el && el.innerText.trim()) {
                            authorElement = el.innerText.trim();
                            break;
                        }
                    }

                    const possibleAuthor = authorMeta || authorElement || document.querySelector('h3 + div, h2 + div')?.innerText || '';

                    const bodyParagraphs = Array.from(document.querySelectorAll('article p, main p, .story-body p, p'))
                        .map(p => p.innerText.trim())
                        .filter(t => t.length > 20)
                        .slice(0, 5)
                        .join(' ');

                    return {
                        author: possibleAuthor.trim(),
                        date: dateMeta.trim(),
                        context: bodyParagraphs
                    };
                }
            });

            const metaRes = metaInjection && metaInjection[0] ? metaInjection[0].result : {};
            const autorDetectadoPagina = metaRes.author || '';
            const fechaDetectadaPagina = metaRes.date || '';
            
            let contextoAdicional = `Autor detectado en DOM: ${autorDetectadoPagina} | Fecha meta: ${fechaDetectadaPagina} | Contenido: ${metaRes.context}`;

            const res = await fetch('http://localhost:3000/api/text_summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    text: tipo === 'in-text' ? `Fragmento seleccionado a citar: "${textoCita}"\n\nContexto general de la página: ${contextoAdicional}` : `Contexto y metadatos de la página:\nAutor detectado: ${autorDetectadoPagina}\nFecha detectada: ${fechaDetectadaPagina}\nContenido: ${metaRes.context}`,
                    pageTitle: tab.title,
                    pageUrl: tab.url,
                    format: formato,
                    mode: 'citations',
                    type: tipo,
                    author: autorDetectadoPagina
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            const data = await res.json();
            mostrarCarga(false);

            if (res.ok && data.result) {
                mostrarResultado(data.result, true, 'citations');
            } else {
                mostrarResultado('Atención: ' + (data.error || "Error al generar la cita."), false, 'citations');
            }
        } catch (err) {
            clearTimeout(timeoutId);
            mostrarCarga(false);
            console.error('Error en citas:', err);
            if (err.name === 'AbortError') {
                mostrarResultado("El servidor tardó demasiado en responder (Timeout). Intenta de nuevo.", false, 'citations');
            } else {
                mostrarResultado("Error de conexión con el servidor.", false, 'citations');
            }
        }
    });

    // --- FUNCIONES AUXILIARES DE UI ---
    function mostrarCarga(isLoading, mensaje = "Procesando...") {
        const loader = document.getElementById('loader');
        const wrapper = document.getElementById('result-wrapper');
        loader.textContent = mensaje;
        
        if (isLoading) {
            loader.style.display = 'block';
            wrapper.style.display = 'none';
        } else {
            loader.style.display = 'none';
        }
    }

    function mostrarResultado(texto, isSuccess, tipoBoton = 'summary') {
        const wrapper = document.getElementById('result-wrapper');
        const container = document.getElementById('result-container');
        const btnCopiar = document.getElementById('btnCopiar');
        const verifyNote = wrapper.querySelector('.verify-note');
        const btnPrincipal = document.getElementById(tipoBoton === 'summary' ? 'btnResumir' : 'btnApa');

        wrapper.style.display = 'block';

        if (isSuccess) {
            btnCopiar.style.display = 'block';
            if (verifyNote) verifyNote.style.display = 'block';
            btnPrincipal.textContent = tipoBoton === 'summary' ? 'Generate Summary' : 'Generate Citation / Reference';
            
            const textoHtmlFormat = texto.replace(/\*(.*?)\*/g, '<em>$1</em>');
            container.innerHTML = textoHtmlFormat;
        } else {
            btnCopiar.style.display = 'none';
            if (verifyNote) verifyNote.style.display = 'none';
            btnPrincipal.textContent = 'Reintentar';
            container.textContent = texto;
        }
    }

    // --- BOTÓN DE COPIAR AL PORTAPAPELOS ---
    document.getElementById('btnCopiar').addEventListener('click', () => {
        const textoFinal = document.getElementById('result-container').innerText;
        if (!textoFinal.trim()) return;
        
        navigator.clipboard.writeText(textoFinal).then(() => {
            const btn = document.getElementById('btnCopiar');
            const originalText = btn.textContent;
            btn.textContent = "¡Copiado al portapapeles!";
            btn.style.backgroundColor = "#138496";
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.backgroundColor = "#28a745";
            }, 2000);
        });
    });

});