
// ==========================================
// PANELA — BUSCADOR DE RECEITAS
// TheMealDB + MyMemory Translation API
// ==========================================

// CONFIGURAÇÃO DAS APIs

const MEAL_API = "https://www.themealdb.com/api/json/v1/1";
const TRANSLATION_API = "https://api.mymemory.translated.net/get";

const MAX_RESULTS = 8;
const MAX_TRANSLATION_CHARACTERS = 4700;


// ELEMENTOS DA PÁGINA

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const randomButton = document.getElementById("randomButton");

const resultsGrid = document.getElementById("resultsGrid");
const resultsStatus = document.getElementById("resultsStatus");

const resultsTitle = document.getElementById("resultsTitle");
const resultsSubtitle = document.getElementById("resultsSubtitle");
const resultsCount = document.getElementById("resultsCount");

const toastContainer = document.getElementById("toastContainer");

const recipeModal = document.getElementById("recipeModal");
const modalContent = document.getElementById("modalContent");
const closeModalButton = document.getElementById("closeModalButton");


// ESTADO E CACHE DA APLICAÇÃO

const translationCache = new Map();
const translationPending = new Map();
const mealDetailsCache = new Map();

let translationCharactersUsed = 0;

let translationServiceUnavailable = false;
let translationServiceError = null;

let currentSearchController = null;
let currentSearchId = 0;

let currentModalController = null;
let currentModalId = 0;

let currentMeals = [];
let previousFocus = null;


// CONFIGURAÇÃO DA PESQUISA

function getSearchMode() {

    return document.querySelector(
        'input[name="searchMode"]:checked'
    ).value;

}


function updateSearchPlaceholder() {

    if (getSearchMode() === "ingredient") {

        searchInput.placeholder =
            "Ex.: frango, batata, tomate...";

    } else {

        searchInput.placeholder =
            "Ex.: lasanha, pizza, bolo de chocolate...";

    }

}


document.querySelectorAll(
    'input[name="searchMode"]'
).forEach(function (radio) {

    radio.addEventListener("change", updateSearchPlaceholder);

});


// REQUISIÇÕES JSON COM TEMPO LIMITE

async function fetchJSON(url, externalSignal) {

    const controller = new AbortController();

    const timeout = setTimeout(function () {

        controller.abort();

    }, 16000);


    function abortRequest() {

        controller.abort();

    }


    if (externalSignal) {

        if (externalSignal.aborted) {

            controller.abort();

        } else {

            externalSignal.addEventListener(
                "abort",
                abortRequest,
                { once: true }
            );

        }

    }


    try {

        const response = await fetch(url, {

            method: "GET",

            signal: controller.signal,

            headers: {
                Accept: "application/json"
            }

        });


        if (!response.ok) {

            throw new Error(
                "A API respondeu com o código " + response.status + "."
            );

        }


        return await response.json();


    } catch (error) {

        if (error.name === "AbortError") {

            if (externalSignal && externalSignal.aborted) {

                throw error;

            }

            throw new Error(
                "A consulta demorou mais que o esperado. Tente novamente."
            );

        }

        throw error;


    } finally {

        clearTimeout(timeout);

        if (externalSignal) {

            externalSignal.removeEventListener(
                "abort",
                abortRequest
            );

        }

    }

}


// TRADUÇÃO DE ENTIDADES HTML

function decodeTranslation(value) {

    const textarea = document.createElement("textarea");

    textarea.innerHTML = String(value || "");

    return textarea.value.trim();

}


// MENSAGEM DE ERRO DA TRADUÇÃO

function translationErrorMessage(error) {

    if (error && error.message === "TRANSLATION_LIMIT") {

        return "O limite diário gratuito de tradução desta sessão foi atingido. Tente novamente amanhã ou reduza o texto consultado.";

    }

    return "O serviço de tradução está indisponível no momento. Confira sua conexão e tente novamente.";

}


// TRADUZ UM TEXTO E GUARDA O RESULTADO NO CACHE

async function translateText(
    text,
    sourceLanguage,
    targetLanguage,
    signal
) {

    const original = String(text || "").trim();

    if (!original) {
        return "";
    }


    const cacheKey =
        sourceLanguage +
        "|" +
        targetLanguage +
        "|" +
        original.toLowerCase();


    if (translationCache.has(cacheKey)) {

        return translationCache.get(cacheKey);

    }


    if (translationPending.has(cacheKey)) {

        return translationPending.get(cacheKey);

    }


    const promise = requestTranslation(
        original,
        sourceLanguage,
        targetLanguage,
        signal
    );


    translationPending.set(cacheKey, promise);


    try {

        const translated = await promise;

        translationCache.set(cacheKey, translated);

        return translated;


    } finally {

        translationPending.delete(cacheKey);

    }

}


// REQUISIÇÃO PARA A API DE TRADUÇÃO

async function requestTranslation(
    original,
    sourceLanguage,
    targetLanguage,
    signal
) {

    if (original.length > 470) {

        throw new Error(
            "O texto ultrapassa o tamanho seguro para uma chamada de tradução."
        );

    }


    if (
        translationCharactersUsed + original.length >
        MAX_TRANSLATION_CHARACTERS
    ) {

        const limitError = new Error(
            "Limite local de tradução atingido."
        );

        limitError.message = "TRANSLATION_LIMIT";

        throw limitError;

    }


    const params = new URLSearchParams({

        q: original,

        langpair: sourceLanguage + "|" + targetLanguage,

        mt: "1"

    });


    translationCharactersUsed += original.length;


    const data = await fetchJSON(
        TRANSLATION_API + "?" + params.toString(),
        signal
    );


    if (
        Number(data.responseStatus) !== 200 ||
        !data.responseData ||
        !data.responseData.translatedText
    ) {

        const detail = data.responseDetails ||
            "A API não retornou uma tradução válida.";

        throw new Error(detail);

    }


    const result = decodeTranslation(
        data.responseData.translatedText
    );


    if (!result) {

        throw new Error(
            "A API retornou uma tradução vazia."
        );

    }


    return result;

}


// DIVIDE TEXTOS LONGOS EM PARTES MENORES

function splitTextByBytes(text, maxBytes) {

    const tokens = String(text).match(/\S+\s*/gu) || [String(text)];

    const encoder = new TextEncoder();

    const chunks = [];

    let current = "";


    tokens.forEach(function (token) {

        if (
            encoder.encode(current + token).length <= maxBytes
        ) {

            current += token;

            return;

        }


        if (current.trim()) {

            chunks.push(current);

            current = "";

        }


        if (encoder.encode(token).length <= maxBytes) {

            current = token;

            return;

        }


        let part = "";


        Array.from(token).forEach(function (character) {

            if (
                encoder.encode(part + character).length > maxBytes
            ) {

                chunks.push(part);

                part = character;

            } else {

                part += character;

            }

        });


        current = part;

    });


    if (current.trim()) {

        chunks.push(current);

    }


    return chunks;

}


// TRADUZ TEXTOS LONGOS EM PARTES

async function translateLongText(
    text,
    sourceLanguage,
    targetLanguage,
    signal
) {

    const original = String(text || "").trim();

    if (!original) return "";


    if (translationServiceUnavailable) {

        throw translationServiceError ||
            new Error("Serviço de tradução indisponível.");

    }


    const chunks = splitTextByBytes(original, 420);

    const translatedChunks = [];


    // REQUISIÇÕES SEQUENCIAIS PARA NÃO SOBRECARREGAR A API

    for (const chunk of chunks) {

        translatedChunks.push(
            await translateText(
                chunk,
                sourceLanguage,
                targetLanguage,
                signal
            )
        );

    }


    return translatedChunks.join("").trim();

}


// TRADUÇÃO COM TRATAMENTO DE ERRO

async function safeTranslate(
    text,
    sourceLanguage,
    targetLanguage,
    signal
) {

    if (!String(text || "").trim()) {

        return {
            text: "",
            translated: true
        };

    }


    if (translationServiceUnavailable) {

        return {
            text: String(text),
            translated: false,
            error: translationServiceError
        };

    }


    try {

        return {

            text: await translateText(
                text,
                sourceLanguage,
                targetLanguage,
                signal
            ),

            translated: true

        };


    } catch (error) {

        if (error.name === "AbortError") {

            throw error;

        }


        translationServiceUnavailable = true;

        translationServiceError = error;


        return {

            text: String(text),

            translated: false,

            error: error

        };

    }

}


// LIMITA A QUANTIDADE DE REQUISIÇÕES SIMULTÂNEAS

async function mapWithLimit(items, limit, callback) {

    const results = new Array(items.length);

    let nextIndex = 0;


    async function worker() {

        while (nextIndex < items.length) {

            const index = nextIndex;

            nextIndex += 1;

            results[index] = await callback(
                items[index],
                index
            );

        }

    }


    const workers = [];

    const totalWorkers = Math.min(
        limit,
        items.length
    );


    for (let i = 0; i < totalWorkers; i += 1) {

        workers.push(worker());

    }


    await Promise.all(workers);

    return results;

}


// INTERFACE: CARREGAMENTO E MENSAGENS

function setBusy(isBusy) {

    searchButton.disabled = isBusy;

    randomButton.disabled = isBusy;


    searchButton.querySelector("span").textContent =
        isBusy ? "Buscando..." : "Buscar receitas";


    randomButton.querySelector(".random-label").textContent =
        isBusy ? "Aguarde..." : "Surpreenda-me";

}


// MOSTRAR CARREGAMENTO

function showSkeletons() {

    resultsStatus.hidden = true;

    resultsGrid.replaceChildren();


    for (let i = 0; i < 8; i += 1) {

        const card = document.createElement("div");

        card.className = "skeleton-card";


        const image = document.createElement("div");

        image.className = "skeleton skeleton-image";


        const lineOne = document.createElement("div");

        lineOne.className = "skeleton skeleton-line long";


        const lineTwo = document.createElement("div");

        lineTwo.className = "skeleton skeleton-line short";


        card.append(image, lineOne, lineTwo);

        resultsGrid.appendChild(card);

    }


    resultsCount.textContent = "Carregando...";

}


// MOSTRAR MENSAGEM DE RESULTADO

function showResultsState(title, description, isError) {

    resultsGrid.replaceChildren();

    resultsStatus.hidden = false;

    resultsStatus.classList.toggle(
        "state-error",
        Boolean(isError)
    );

    resultsStatus.replaceChildren();


    const illustration = document.createElement("div");

    illustration.className = "empty-illustration";

    illustration.setAttribute("aria-hidden", "true");


    const plate = document.createElement("span");

    plate.className = "empty-plate";


    const leafOne = document.createElement("span");

    leafOne.className = "empty-leaf empty-leaf-one";


    const leafTwo = document.createElement("span");

    leafTwo.className = "empty-leaf empty-leaf-two";


    const spark = document.createElement("span");

    spark.className = "empty-spark";

    spark.textContent = isError ? "!" : "✳";


    illustration.append(
        plate,
        leafOne,
        leafTwo,
        spark
    );


    const heading = document.createElement("h3");

    heading.textContent = title;


    const paragraph = document.createElement("p");

    paragraph.textContent = description;


    resultsStatus.append(
        illustration,
        heading,
        paragraph
    );


    resultsCount.textContent = "0 receitas";

}


// MENSAGEM TEMPORÁRIA

function showToast(message, type) {

    const toast = document.createElement("div");

    toast.className =
        "toast" + (type === "error" ? " error" : "");

    toast.textContent = message;


    toastContainer.appendChild(toast);


    setTimeout(function () {

        toast.style.opacity = "0";

        toast.style.transform = "translateY(6px)";


        setTimeout(function () {

            toast.remove();

        }, 250);

    }, 5000);

}


// VERIFICA SE A PESQUISA AINDA É A ATUAL

function isCurrentSearch(searchId) {

    return searchId === currentSearchId;

}


// CRIA ENDEREÇO PARA A THEMEALDB

function mealEndpoint(path, params) {

    const query = new URLSearchParams(params || {});

    return MEAL_API +
        "/" +
        path +
        (query.toString() ? "?" + query.toString() : "");

}


// NORMALIZA OS TERMOS DE PESQUISA

function normalizeSearchTerm(text) {

    return String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

}


// CONVERTE O INGREDIENTE PARA O FORMATO DA THEMEALDB

function ingredientSlug(
    originalIngredient,
    translatedIngredient
) {

    const commonIngredients = {

        "carne": "beef",
        "carne bovina": "beef",
        "carne moida": "beef",
        "carne de boi": "beef",
        "carne suina": "pork",
        "carne de porco": "pork",

        "frango": "chicken",
        "batata": "potato",
        "arroz": "rice",

        "ovo": "egg",
        "ovos": "egg",

        "tomate": "tomato",
        "queijo": "cheese",
        "peixe": "fish",
        "camarao": "prawn",

        "cebola": "onion",
        "alho": "garlic",
        "leite": "milk",
        "farinha": "flour"

    };


    const original = normalizeSearchTerm(
        originalIngredient
    );


    const resolved =
        commonIngredients[original] ||
        translatedIngredient;


    return normalizeSearchTerm(resolved)
        .replace(/\s+/g, "_");

}


// ==========================================
// PESQUISA DE RECEITAS
// ==========================================

async function searchRecipes(query, mode) {

    if (currentSearchController) {

        currentSearchController.abort();

    }


    const controller = new AbortController();

    currentSearchController = controller;


    const searchId = ++currentSearchId;


    setBusy(true);

    showSkeletons();


    resultsTitle.textContent =
        mode === "ingredient"
            ? "Receitas com " + query
            : "Resultados para " + query;


    resultsSubtitle.textContent =
        "Estamos procurando opções para você.";


    let currentStep = "translation";


    try {

        // PRIMEIRO: TRADUZIR A PESQUISA PARA INGLÊS

        const translatedQuery = await translateText(
            query,
            "pt",
            "en",
            controller.signal
        );


        if (!isCurrentSearch(searchId)) return;


        let meals = [];

        currentStep = "recipes";


        // PESQUISA POR INGREDIENTE

        if (mode === "ingredient") {

            const ingredient = ingredientSlug(
                query,
                translatedQuery
            );


            const filterData = await fetchJSON(

                mealEndpoint(
                    "filter.php",
                    { i: ingredient }
                ),

                controller.signal

            );


            if (!isCurrentSearch(searchId)) return;


            const filteredMeals = Array.isArray(filterData.meals)
                ? filterData.meals.slice(0, MAX_RESULTS)
                : [];


            if (filteredMeals.length) {

                const detailedMeals = await mapWithLimit(
                    filteredMeals,
                    4,
                    async function (meal) {

                        try {

                            const detailsData = await fetchJSON(

                                mealEndpoint(
                                    "lookup.php",
                                    { i: meal.idMeal }
                                ),

                                controller.signal

                            );


                            return detailsData.meals &&
                                detailsData.meals[0]
                                    ? detailsData.meals[0]
                                    : meal;


                        } catch (error) {

                            if (error.name === "AbortError") {

                                throw error;

                            }

                            return meal;

                        }

                    }
                );


                meals = detailedMeals;

            }


        } else {

            // PESQUISA PELO NOME DO PRATO

            const searchData = await fetchJSON(

                mealEndpoint(
                    "search.php",
                    { s: translatedQuery }
                ),

                controller.signal

            );


            if (!isCurrentSearch(searchId)) return;


            meals = Array.isArray(searchData.meals)
                ? searchData.meals.slice(0, MAX_RESULTS)
                : [];

        }


        if (!isCurrentSearch(searchId)) return;


        // NENHUMA RECEITA ENCONTRADA

        if (!meals.length) {

            const emptyText = mode === "ingredient"

                ? "Não encontramos receitas com esse ingrediente na base. Experimente outro ingrediente ou tente o nome de um prato."

                : "Não encontramos esse prato na base de receitas. Tente outro nome ou pesquise por um ingrediente.";


            resultsTitle.textContent =
                "Nenhuma receita encontrada";


            resultsSubtitle.textContent =
                "Sua próxima ideia pode estar em outra busca.";


            showResultsState(
                "Não encontramos essa receita por aqui.",
                emptyText,
                false
            );


            return;

        }


        // TRADUZIR OS RESULTADOS

        resultsSubtitle.textContent =
            "Receitas reais encontradas na base TheMealDB. Selecione uma para ver o preparo.";


        const enrichedMeals = await enrichMealCards(
            meals,
            controller.signal
        );


        if (!isCurrentSearch(searchId)) return;


        currentMeals = enrichedMeals;


        renderMealCards(enrichedMeals);


        resultsCount.textContent =
            enrichedMeals.length +
            (enrichedMeals.length === 1
                ? " receita"
                : " receitas");


        const someTranslationsMissing = enrichedMeals.some(
            function (meal) {

                return !meal._titleTranslated ||
                    !meal._categoryTranslated ||
                    !meal._areaTranslated;

            }
        );


        if (someTranslationsMissing) {

            showToast(
                "Algumas informações permaneceram no idioma original porque a tradução não foi concluída.",
                "error"
            );

        }


    } catch (error) {

        if (
            !isCurrentSearch(searchId) ||
            error.name === "AbortError"
        ) {

            return;

        }


        console.error("Erro na pesquisa:", error);


        resultsTitle.textContent =
            "Não foi possível concluir a busca";


        resultsSubtitle.textContent =
            "Confira sua conexão e tente mais uma vez.";


        let message =
            "Ocorreu um problema ao consultar as APIs. Tente novamente em instantes.";


        if (
            currentStep === "translation" ||
            error.message === "TRANSLATION_LIMIT"
        ) {

            translationServiceUnavailable = true;

            translationServiceError = error;

            message = translationErrorMessage(error);

        } else if (
            error.message &&
            error.message.includes("tradução")
        ) {

            message = translationErrorMessage(error);

        }


        showResultsState(
            "Ops! Não conseguimos fazer essa busca.",
            message,
            true
        );


        showToast(message, "error");


    } finally {

        if (isCurrentSearch(searchId)) {

            setBusy(false);

            currentSearchController = null;

        }

    }

}


// TRADUZ AS INFORMAÇÕES DOS CARDS

async function enrichMealCards(meals, signal) {

    return mapWithLimit(
        meals,
        3,
        async function (meal) {

            const titleResult = await safeTranslate(
                meal.strMeal || "Receita sem nome",
                "en",
                "pt",
                signal
            );


            const categoryResult = await safeTranslate(
                meal.strCategory || "",
                "en",
                "pt",
                signal
            );


            const areaResult = await safeTranslate(
                meal.strArea || "",
                "en",
                "pt",
                signal
            );


            return Object.assign({}, meal, {

                _displayName:
                    titleResult.text ||
                    meal.strMeal ||
                    "Receita sem nome",

                _titleTranslated:
                    titleResult.translated,


                _displayCategory:
                    categoryResult.text ||
                    "Categoria não informada",

                _categoryTranslated:
                    categoryResult.translated,


                _displayArea:
                    areaResult.text ||
                    "Origem não informada",

                _areaTranslated:
                    areaResult.translated

            });

        }
    );

}


// CRIAR ELEMENTOS DE TEXTO COM SEGURANÇA

function createTextElement(tag, className, text) {

    const element = document.createElement(tag);

    if (className) {

        element.className = className;

    }

    element.textContent = text || "";

    return element;

}


// ==========================================
// EXIBIR OS CARDS DAS RECEITAS
// ==========================================

function renderMealCards(meals) {

    resultsStatus.hidden = true;

    resultsGrid.replaceChildren();


    const fragment = document.createDocumentFragment();


    meals.forEach(function (meal, index) {

        const card = document.createElement("article");

        card.className = "recipe-card";

        card.style.animationDelay =
            (index * 45) + "ms";


        const imageWrap = document.createElement("div");

        imageWrap.className = "recipe-image-wrap";


        if (meal.strMealThumb) {

            const image = document.createElement("img");

            image.className = "recipe-image";

            image.src = meal.strMealThumb;

            image.alt =
                "Foto de " +
                (meal._displayName ||
                    meal.strMeal ||
                    "uma receita");

            image.loading = "lazy";

            image.referrerPolicy = "no-referrer";


            image.addEventListener("error", function () {

                const fallback = createTextElement(
                    "div",
                    "recipe-image-fallback",
                    "✳"
                );

                image.replaceWith(fallback);

            }, { once: true });


            imageWrap.appendChild(image);


        } else {

            imageWrap.appendChild(
                createTextElement(
                    "div",
                    "recipe-image-fallback",
                    "✳"
                )
            );

        }


        imageWrap.appendChild(
            createTextElement(
                "span",
                "recipe-tag",
                meal._displayCategory || "Receita"
            )
        );


        const body = document.createElement("div");

        body.className = "recipe-card-body";


        body.appendChild(
            createTextElement(
                "div",
                "recipe-country",
                meal._displayArea || "Origem não informada"
            )
        );


        if (!meal._titleTranslated) {

            body.appendChild(
                createTextElement(
                    "span",
                    "translation-flag",
                    "nome original"
                )
            );

        }


        body.appendChild(
            createTextElement(
                "h3",
                "",
                meal._displayName ||
                meal.strMeal ||
                "Receita sem nome"
            )
        );


        const footer = document.createElement("div");

        footer.className = "recipe-card-footer";


        footer.appendChild(
            createTextElement(
                "span",
                "",
                "Veja ingredientes e preparo"
            )
        );


        const viewButton = document.createElement("button");

        viewButton.type = "button";

        viewButton.className = "view-recipe";

        viewButton.dataset.mealId = meal.idMeal || "";


        viewButton.appendChild(
            document.createTextNode("Ver receita ")
        );


        viewButton.appendChild(
            createTextElement("span", "", "→")
        );


        footer.appendChild(viewButton);


        body.appendChild(footer);

        card.append(imageWrap, body);

        fragment.appendChild(card);

    });


    resultsGrid.appendChild(fragment);

}


// ==========================================
// DETALHES DA RECEITA
// ==========================================


// BUSCAR INGREDIENTES E QUANTIDADES

function getMealIngredients(meal) {

    const ingredients = [];


    for (let i = 1; i <= 20; i += 1) {

        const ingredient = String(
            meal["strIngredient" + i] || ""
        ).trim();


        const measure = String(
            meal["strMeasure" + i] || ""
        ).trim();


        if (ingredient) {

            ingredients.push({

                name: ingredient,

                measure: measure

            });

        }

    }


    return ingredients;

}


// VALIDAR LINKS EXTERNOS

function safeExternalUrl(value) {

    if (!value) return "";


    try {

        const url = new URL(value);


        if (
            url.protocol === "https:" ||
            url.protocol === "http:"
        ) {

            return url.href;

        }

    } catch (error) {

        return "";

    }


    return "";

}


// MOSTRAR CARREGAMENTO DO MODAL

function showModalLoading() {

    modalContent.replaceChildren();


    const loading = document.createElement("div");

    loading.className = "modal-loading";


    const ring = document.createElement("div");

    ring.className = "loader-ring";


    const message = createTextElement(
        "p",
        "",
        "Buscando ingredientes e traduzindo o modo de preparo..."
    );


    loading.append(ring, message);

    modalContent.appendChild(loading);

}


// ABRIR UMA RECEITA

async function openRecipe(meal) {

    if (currentModalController) {

        currentModalController.abort();

    }


    const controller = new AbortController();

    currentModalController = controller;


    const modalId = ++currentModalId;


    previousFocus = document.activeElement;


    recipeModal.classList.add("is-open");

    recipeModal.setAttribute("aria-hidden", "false");

    document.body.style.overflow = "hidden";


    showModalLoading();

    closeModalButton.focus();


    try {

        let fullMeal = meal;


        // CONSULTAR DETALHES COMPLETOS

        if (
            !meal.strInstructions ||
            !meal.strIngredient1
        ) {

            if (mealDetailsCache.has(meal.idMeal)) {

                fullMeal = mealDetailsCache.get(meal.idMeal);

            } else {

                const detailsData = await fetchJSON(

                    mealEndpoint(
                        "lookup.php",
                        { i: meal.idMeal }
                    ),

                    controller.signal

                );


                if (
                    !detailsData.meals ||
                    !detailsData.meals[0]
                ) {

                    throw new Error(
                        "Não foi possível encontrar os detalhes desta receita."
                    );

                }


                fullMeal = detailsData.meals[0];

                mealDetailsCache.set(
                    meal.idMeal,
                    fullMeal
                );

            }

        } else {

            mealDetailsCache.set(
                meal.idMeal,
                meal
            );

        }


        if (modalId !== currentModalId) return;


        // TRADUZIR AS INFORMAÇÕES PRINCIPAIS

        const translatedTitle = await safeTranslate(
            fullMeal.strMeal || "Receita",
            "en",
            "pt",
            controller.signal
        );


        const translatedCategory = await safeTranslate(
            fullMeal.strCategory || "",
            "en",
            "pt",
            controller.signal
        );


        const translatedArea = await safeTranslate(
            fullMeal.strArea || "",
            "en",
            "pt",
            controller.signal
        );


        // TRADUZIR INGREDIENTES

        const ingredients = getMealIngredients(fullMeal);


        const translatedIngredients = await mapWithLimit(
            ingredients,
            3,
            async function (item) {

                const result = await safeTranslate(
                    item.name,
                    "en",
                    "pt",
                    controller.signal
                );


                return {

                    name: result.text,

                    originalName: item.name,

                    measure: item.measure,

                    translated: result.translated

                };

            }
        );


        // TRADUZIR MODO DE PREPARO

        let translatedInstructions = {

            text:
                fullMeal.strInstructions ||
                "O modo de preparo não foi informado pela fonte.",

            translated: false

        };


        if (fullMeal.strInstructions) {

            try {

                translatedInstructions = {

                    text: await translateLongText(
                        fullMeal.strInstructions,
                        "en",
                        "pt",
                        controller.signal
                    ),

                    translated: true

                };


            } catch (error) {

                if (error.name === "AbortError") {

                    throw error;

                }


                translatedInstructions = {

                    text: fullMeal.strInstructions,

                    translated: false,

                    error: error

                };

            }

        }


        if (modalId !== currentModalId) return;


        // MOSTRAR OS DETALHES

        renderRecipeDetails(fullMeal, {

            title: translatedTitle,

            category: translatedCategory,

            area: translatedArea,

            ingredients: translatedIngredients,

            instructions: translatedInstructions

        });


    } catch (error) {

        if (
            error.name === "AbortError" ||
            modalId !== currentModalId
        ) {

            return;

        }


        console.error("Erro ao abrir receita:", error);


        modalContent.replaceChildren();


        const errorBox = document.createElement("div");

        errorBox.className = "modal-loading";


        errorBox.append(

            createTextElement(
                "h2",
                "",
                "Não foi possível abrir esta receita"
            ),

            createTextElement(
                "p",
                "",
                "Confira sua conexão e tente novamente."
            )

        );


        modalContent.appendChild(errorBox);


        showToast(
            "Não foi possível carregar os detalhes da receita.",
            "error"
        );

    }

}


// SEPARAR O PREPARO EM PARÁGRAFOS

function appendRecipeParagraphs(container, text) {

    const content = String(text || "")
        .replace(/\r/g, "")
        .trim();


    const paragraphs = content
        .split(/\n{2,}/)
        .map(function (part) {
            return part.trim();
        })
        .filter(Boolean);


    if (paragraphs.length) {

        paragraphs.forEach(function (paragraph) {

            container.appendChild(
                createTextElement("p", "", paragraph)
            );

        });

    } else {

        container.appendChild(
            createTextElement(
                "p",
                "",
                "Modo de preparo não informado."
            )
        );

    }

}


// MONTAR A JANELA DE DETALHES

function renderRecipeDetails(meal, translated) {

    modalContent.replaceChildren();


    // CABEÇALHO DA RECEITA

    const hero = document.createElement("div");

    hero.className = "modal-hero";


    if (meal.strMealThumb) {

        const image = document.createElement("img");

        image.className = "modal-hero-image";

        image.src = meal.strMealThumb;

        image.alt =
            "Foto de " +
            (translated.title.text || meal.strMeal);

        image.referrerPolicy = "no-referrer";


        image.addEventListener("error", function () {

            image.style.display = "none";

        }, { once: true });


        hero.appendChild(image);

    }


    const heroCopy = document.createElement("div");

    heroCopy.className = "modal-hero-copy";


    heroCopy.appendChild(
        createTextElement(
            "div",
            "modal-kicker",
            "RECEITA PARA EXPERIMENTAR"
        )
    );


    heroCopy.appendChild(
        createTextElement(
            "h2",
            "",
            translated.title.text ||
            meal.strMeal ||
            "Receita"
        )
    );


    const meta = document.createElement("div");

    meta.className = "modal-meta";


    meta.appendChild(
        createTextElement(
            "span",
            "",
            translated.category.text ||
            "Categoria não informada"
        )
    );


    meta.appendChild(
        createTextElement(
            "span",
            "",
            translated.area.text ||
            "Origem não informada"
        )
    );


    heroCopy.appendChild(meta);


    const titleIsTranslated = translated.title.translated;


    if (!titleIsTranslated) {

        heroCopy.appendChild(
            createTextElement(
                "p",
                "modal-translation-note",
                "Nome original mantido: a tradução não ficou disponível."
            )
        );

    }


    hero.appendChild(heroCopy);


    // CORPO DO MODAL

    const body = document.createElement("div");

    body.className = "modal-body";


    // COLUNA DOS INGREDIENTES

    const ingredientsColumn = document.createElement("section");

    ingredientsColumn.className = "ingredients-column";


    ingredientsColumn.appendChild(
        createModalSectionTitle(
            "Ingredientes",
            "＋"
        )
    );


    const ingredientList = document.createElement("ul");

    ingredientList.className = "ingredient-list";


    if (translated.ingredients.length) {

        translated.ingredients.forEach(function (item) {

            const listItem = document.createElement("li");


            listItem.appendChild(
                createTextElement(
                    "span",
                    "",
                    item.name || item.originalName
                )
            );


            listItem.appendChild(
                createTextElement(
                    "span",
                    "",
                    item.measure
                )
            );


            ingredientList.appendChild(listItem);

        });


    } else {

        ingredientList.appendChild(
            createTextElement(
                "li",
                "",
                "A fonte não informou os ingredientes."
            )
        );

    }


    ingredientsColumn.appendChild(ingredientList);


    // COLUNA DO MODO DE PREPARO

    const instructionsColumn = document.createElement("section");

    instructionsColumn.className = "instructions-column";


    instructionsColumn.appendChild(
        createModalSectionTitle(
            "Modo de preparo",
            "↗"
        )
    );


    const instructions = document.createElement("div");

    instructions.className = "instructions";


    appendRecipeParagraphs(
        instructions,
        translated.instructions.text
    );


    instructionsColumn.appendChild(instructions);


    // AVISO QUANDO NÃO FOI POSSÍVEL TRADUZIR

    if (!translated.instructions.translated) {

        instructionsColumn.appendChild(
            createTextElement(

                "div",

                "translation-warning",

                "A tradução do preparo não ficou disponível. O texto abaixo está no idioma original da receita; ele não foi apresentado como tradução. " +
                translationErrorMessage(
                    translated.instructions.error
                )

            )
        );

    }


    // LINKS PARA VÍDEO E RECEITA ORIGINAL

    const links = document.createElement("div");

    links.className = "recipe-links";


    const videoUrl = safeExternalUrl(
        meal.strYoutube
    );

    const sourceUrl = safeExternalUrl(
        meal.strSource
    );


    if (videoUrl) {

        links.appendChild(
            createExternalLink(
                videoUrl,
                "Assistir ao vídeo",
                "primary"
            )
        );

    }


    if (sourceUrl) {

        links.appendChild(
            createExternalLink(
                sourceUrl,
                "Receita original",
                ""
            )
        );

    }


    if (links.children.length) {

        instructionsColumn.appendChild(links);

    }


    // AVISO DE TRADUÇÃO DE INGREDIENTES

    const hasIngredientTranslation =
        translated.ingredients.every(function (item) {

            return item.translated;

        });


    const metadataTranslated =
        translated.category.translated &&
        translated.area.translated;


    if (
        !hasIngredientTranslation ||
        !metadataTranslated
    ) {

        const warning = createTextElement(

            "div",

            "translation-warning",

            "Alguns termos ficaram no idioma original porque o serviço de tradução não os retornou. Os dados da receita continuam sendo os fornecidos pela TheMealDB."

        );


        ingredientsColumn.appendChild(warning);

    }


    body.append(
        ingredientsColumn,
        instructionsColumn
    );


    modalContent.append(
        hero,
        body
    );

}


// TÍTULO DAS SEÇÕES DO MODAL

function createModalSectionTitle(title, icon) {

    const heading = document.createElement("h3");

    heading.className = "modal-section-title";


    heading.appendChild(
        createTextElement(
            "span",
            "",
            icon
        )
    );


    heading.appendChild(
        document.createTextNode(title)
    );


    return heading;

}


// CRIAR LINKS EXTERNOS

function createExternalLink(url, label, extraClass) {

    const link = document.createElement("a");

    link.className =
        "recipe-link" +
        (extraClass ? " " + extraClass : "");


    link.href = url;

    link.target = "_blank";

    link.rel = "noopener noreferrer";

    link.textContent = label + " ↗";


    return link;

}


// FECHAR A JANELA DA RECEITA

function closeRecipeModal() {

    if (!recipeModal.classList.contains("is-open")) {
        return;
    }


    recipeModal.classList.remove("is-open");

    recipeModal.setAttribute("aria-hidden", "true");

    document.body.style.overflow = "";


    currentModalId += 1;


    if (currentModalController) {

        currentModalController.abort();

        currentModalController = null;

    }


    if (
        previousFocus &&
        typeof previousFocus.focus === "function"
    ) {

        previousFocus.focus();

    }

}


// ==========================================
// RECEITA ALEATÓRIA
// ==========================================

async function getRandomRecipe() {

    if (currentSearchController) {

        currentSearchController.abort();

    }


    const controller = new AbortController();

    currentSearchController = controller;


    const searchId = ++currentSearchId;


    setBusy(true);

    showSkeletons();


    resultsTitle.textContent =
        "Uma surpresa para sua cozinha";


    resultsSubtitle.textContent =
        "Buscando uma receita aleatória na TheMealDB.";


    try {

        // CONSULTAR UMA RECEITA ALEATÓRIA

        const data = await fetchJSON(
            mealEndpoint("random.php"),
            controller.signal
        );


        if (!isCurrentSearch(searchId)) return;


        if (!data.meals || !data.meals[0]) {

            throw new Error(
                "A API não encontrou uma receita aleatória."
            );

        }


        const meal = data.meals[0];


        // TRADUZIR INFORMAÇÕES

        const enriched = await enrichMealCards(
            [meal],
            controller.signal
        );


        if (!isCurrentSearch(searchId)) return;


        currentMeals = enriched;


        resultsSubtitle.textContent =
            "Uma receita real escolhida aleatoriamente. Abra os detalhes e experimente.";


        renderMealCards(enriched);


        resultsCount.textContent = "1 receita";


        // ABRIR AUTOMATICAMENTE OS DETALHES

        openRecipe(enriched[0]);


    } catch (error) {

        if (
            !isCurrentSearch(searchId) ||
            error.name === "AbortError"
        ) {

            return;

        }


        console.error(
            "Erro ao buscar receita aleatória:",
            error
        );


        resultsTitle.textContent =
            "Não foi possível encontrar uma surpresa";


        resultsSubtitle.textContent =
            "Tente novamente em alguns instantes.";


        showResultsState(
            "A receita aleatória não carregou.",
            "A API pode estar temporariamente indisponível. Tente novamente.",
            true
        );


        showToast(
            "Não foi possível consultar a receita aleatória.",
            "error"
        );


    } finally {

        if (isCurrentSearch(searchId)) {

            setBusy(false);

            currentSearchController = null;

        }

    }

}


// ==========================================
// EVENTOS DO FORMULÁRIO
// ==========================================


// PESQUISAR AO CLICAR NO BOTÃO OU PRESSIONAR ENTER

searchForm.addEventListener("submit", function (event) {

    event.preventDefault();


    const query = searchInput.value.trim();


    if (!query) {

        searchInput.focus();

        searchInput.setCustomValidity(
            "Digite um ingrediente ou nome de prato."
        );

        searchInput.reportValidity();

        return;

    }


    searchInput.setCustomValidity("");


    searchRecipes(
        query,
        getSearchMode()
    );

});


// LIMPAR AVISO DO CAMPO AO DIGITAR

searchInput.addEventListener("input", function () {

    searchInput.setCustomValidity("");

});


// BOTÃO DE RECEITA ALEATÓRIA

randomButton.addEventListener(
    "click",
    getRandomRecipe
);


// ==========================================
// BOTÕES DOS CARDS
// ==========================================

resultsGrid.addEventListener("click", function (event) {

    const button = event.target.closest(
        "button[data-meal-id]"
    );


    if (!button) return;


    const meal = currentMeals.find(function (item) {

        return String(item.idMeal) ===
            String(button.dataset.mealId);

    });


    if (meal) {

        openRecipe(meal);

    }

});


// ==========================================
// PESQUISAS RÁPIDAS
// ==========================================

document.querySelectorAll(".quick-chip").forEach(
    function (chip) {

        chip.addEventListener("click", function () {

            const mode = chip.dataset.mode;

            const query = chip.dataset.query;


            const modeRadio = document.querySelector(
                'input[name="searchMode"][value="' +
                mode +
                '"]'
            );


            if (modeRadio) {

                modeRadio.checked = true;

            }


            updateSearchPlaceholder();


            searchInput.value = query;


            searchRecipes(
                query,
                mode
            );

        });

    }
);


// ==========================================
// FECHAMENTO DO MODAL
// ==========================================

closeModalButton.addEventListener(
    "click",
    closeRecipeModal
);


recipeModal.querySelector(
    "[data-close-modal]"
).addEventListener(
    "click",
    closeRecipeModal
);


// FECHAR AO PRESSIONAR ESCAPE

document.addEventListener("keydown", function (event) {

    if (event.key === "Escape") {

        closeRecipeModal();

    }


    // CONTROLE DO FOCO DENTRO DA JANELA

    if (
        event.key === "Tab" &&
        recipeModal.classList.contains("is-open")
    ) {

        const focusable = Array.from(
            recipeModal.querySelectorAll(
                "button, a[href], input, [tabindex]:not([tabindex='-1'])"
            )
        ).filter(function (element) {

            return !element.disabled &&
                element.offsetParent !== null;

        });


        if (!focusable.length) return;


        const first = focusable[0];

        const last = focusable[focusable.length - 1];


        if (
            event.shiftKey &&
            document.activeElement === first
        ) {

            event.preventDefault();

            last.focus();

        } else if (
            !event.shiftKey &&
            document.activeElement === last
        ) {

            event.preventDefault();

            first.focus();

        }

    }

});


// ==========================================
// INICIALIZAÇÃO
// ==========================================

updateSearchPlaceholder();
