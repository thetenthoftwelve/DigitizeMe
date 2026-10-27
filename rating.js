// ===== Connect to Supabase (paste YOUR values from Project Settings → API) =====
// ===== Connect to Supabase (paste YOUR values from Project Settings → API) =====
const SUPABASE_URL = "https://zlifhovuphyrexufranq.supabase.co";
const SUPABASE_KEY = "sb_publishable_OnNP6PYDDBEp-zWzFPJp3A_hHQMgTDF";

console.log("Using URL:", SUPABASE_URL);   // <-- the new line

if (SUPABASE_URL.includes("YOUR-PROJECT-ID") || SUPABASE_KEY.includes("YOUR-ANON")) {
    console.warn("Supabase URL/key not set yet. Suggestions will only work until you refresh.");
}

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Saved comments grouped by row: { battery: [{text, count, mood}], price: [...] }
let savedComments = {};

async function loadComments() {
    const { data, error } = await db
        .from("comments")
        .select("category, text, count, mood")
        .order("count", { ascending: false })
        .limit(2000);

    if (error) {
        console.error("Could not load comments:", error);
        return;
    }
    data.forEach(function (c) {
        if (!savedComments[c.category]) savedComments[c.category] = [];
        savedComments[c.category].push(c);
    });
    console.log("Loaded", data.length, "comments from Supabase");
}

loadComments();

async function saveCommentToDb(category, text, mood, messageBox) {
    const { error } = await db.rpc("add_comment", {
        new_category: category,
        new_text: text,
        new_mood: mood
    });
    if (error) {
        console.error("Could not save comment:", error);
        messageBox.textContent = "Saved here, but not online (check console)";
    } else {
        console.log("Saved to Supabase:", category, text);
    }
}

// ===== Shared helpers (same for every row) =====
const goodWords = ["good", "great", "amazing", "excellent", "awesome", "love", "best",
                   "solid", "long", "fast", "quick", "decent", "nice", "smooth", "helpful",
                   "cheap", "sturdy", "strong"];
const badWords = ["bad", "poor", "terrible", "awful", "worst", "weak", "slow",
                  "drains", "dies", "hot", "short", "disappointing", "expensive",
                  "laggy", "buggy", "fragile", "rude", "useless"];

// How many letters apart are two words? ("batery" vs "battery" = 1)
function typoDistance(a, b) {
    const grid = [];
    for (let i = 0; i <= a.length; i++) grid[i] = [i];
    for (let j = 0; j <= b.length; j++) grid[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            grid[i][j] = Math.min(
                grid[i - 1][j] + 1,
                grid[i][j - 1] + 1,
                grid[i - 1][j - 1] + cost
            );
        }
    }
    return grid[a.length][b.length];
}

function wordMatches(typedWord, savedWord) {
    if (savedWord.startsWith(typedWord)) return true; // still typing: "g" → "good"
    if (typedWord.length < 4) return false;

    const allowed = typedWord.length >= 7 ? 2 : 1;
    const closeToWhole = typoDistance(typedWord, savedWord) <= allowed;
    const closeToStart = typoDistance(typedWord, savedWord.slice(0, typedWord.length)) <= allowed;
    return closeToWhole || closeToStart;
}

function splitWords(text) {
    return text.toLowerCase().split(/[\s,]+/).filter(function (w) { return w !== ""; });
}

// happy (1), unhappy (-1) or neutral (0)?
function getMood(text) {
    let mood = 0;
    splitWords(text).forEach(function (w) {
        if (w.length < 3) return;
        if (goodWords.some(function (g) { return wordMatches(w, g); })) mood++;
        if (badWords.some(function (b) { return wordMatches(w, b); })) mood--;
    });
    return Math.sign(mood);
}

function startsLike(typedText, savedText) {
    const typed = typedText.toLowerCase();
    const start = savedText.toLowerCase().slice(0, typed.length);
    if (start === typed) return true;
    const allowed = typed.length >= 7 ? 2 : 1;
    return typed.length >= 4 && typoDistance(typed, start) <= allowed;
}

function scoreComment(typedText, savedText) {
    const typedWords = splitWords(typedText);
    const savedWords = splitWords(savedText);
    let matched = 0;
    typedWords.forEach(function (typedWord) {
        const found = savedWords.some(function (savedWord) {
            return wordMatches(typedWord, savedWord);
        });
        if (found) matched++;
    });
    return matched / typedWords.length;
}

// Only looks at comments from ONE row (category)
function getSuggestions(typedText, category) {
    const typedMood = getMood(typedText);
    const list = savedComments[category] || [];

    return list
        .map(function (c) {
            let score = scoreComment(typedText, c.text);
            if (startsLike(typedText, c.text)) score += 1;
            if (typedMood !== 0 && c.mood === typedMood) score += 0.5;
            if (typedMood !== 0 && c.mood === -typedMood) score -= 1;
            return { text: c.text, score: score, count: c.count };
        })
        .filter(function (item) { return item.score >= 0.5; })
        .sort(function (a, b) { return b.score - a.score || b.count - a.count; })
        .slice(0, 5);
}

// ===== AI (Gemini Nano, Chrome only) - one session per row =====
const aiOptions = {
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }]
};

async function createAiSession(label) {
    try {
        if (!("LanguageModel" in self)) return null;

        const status = await LanguageModel.availability(aiOptions);
        if (status === "unavailable") return null;

        return await LanguageModel.create({
            ...aiOptions,
            initialPrompts: [{
                role: "system",
                content: "You finish short phone review comments about " + label + ". " +
                         "Reply ONLY with 3 suggestions, one per line, no numbers or bullets. " +
                         "Each must start with the exact words the user typed and keep their feeling."
            }]
        });
    } catch (error) {
        console.log("AI not available:", error);
        return null;
    }
}

// ===== Sets up ONE comment box. We call it for every row. =====
function setupSuggester(wrap) {
    const category = wrap.dataset.category;
    const label = wrap.dataset.label || category;
    const commentInput = wrap.querySelector("input");
    const suggestionBox = wrap.querySelector(".suggestions");
    const commentMessage = wrap.querySelector(".comment-message");

    let activeIndex = -1;
    let aiSession = null;
    let aiTimer;

    function pick(text) {
        commentInput.value = text;
        suggestionBox.hidden = true;
        activeIndex = -1;
    }

    function addSuggestion(text, isAi) {
        const li = document.createElement("li");
        li.textContent = isAi ? "✨ " + text : text;
        li.dataset.value = text;
        if (isAi) li.classList.add("ai");
        li.addEventListener("mousedown", function (event) {
            event.preventDefault(); // keep focus in the input
            pick(text);
        });
        suggestionBox.appendChild(li);
    }

    function highlight(index) {
        const items = suggestionBox.children;
        for (let i = 0; i < items.length; i++) {
            items[i].classList.toggle("active", i === index);
        }
        activeIndex = index;
    }

    function showSuggestions() {
        const typedText = commentInput.value.trim();
        suggestionBox.innerHTML = "";
        activeIndex = -1;

        const suggestions = typedText === "" ? [] : getSuggestions(typedText, category);
        suggestions.forEach(function (item) { addSuggestion(item.text, false); });
        suggestionBox.hidden = suggestions.length === 0;
    }

    commentInput.addEventListener("input", showSuggestions);
    commentInput.addEventListener("blur", function () { suggestionBox.hidden = true; });

    // Keys: ↑/↓ move, Tab/Enter pick, Esc close, Enter (nothing picked) = save
    commentInput.addEventListener("keydown", function (event) {
        const items = suggestionBox.children;
        const listOpen = !suggestionBox.hidden && items.length > 0;

        if (listOpen && event.key === "ArrowDown") {
            event.preventDefault();
            highlight((activeIndex + 1) % items.length);
            return;
        }
        if (listOpen && event.key === "ArrowUp") {
            event.preventDefault();
            highlight(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
            return;
        }
        if (listOpen && event.key === "Tab") {
            event.preventDefault();
            pick(items[Math.max(activeIndex, 0)].dataset.value);
            return;
        }
        if (event.key === "Escape") {
            suggestionBox.hidden = true;
            return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault(); // stops the form from submitting/reloading

        if (listOpen && activeIndex >= 0) {
            pick(items[activeIndex].dataset.value);
            return;
        }

        const newComment = commentInput.value.trim();
        if (newComment === "") return;

        if (!savedComments[category]) savedComments[category] = [];
        const list = savedComments[category];

        const existing = list.find(function (c) {
            return c.text.toLowerCase() === newComment.toLowerCase();
        });

        if (existing) {
            existing.count++;
            commentMessage.textContent = "Already a suggestion, bumped it up!";
        } else {
            list.push({ text: newComment, count: 1, mood: getMood(newComment) });
            commentMessage.textContent = "Comment added!";
        }

        saveCommentToDb(category, newComment, getMood(newComment), commentMessage);

        commentInput.value = "";
        suggestionBox.hidden = true;
    });

    // ----- AI extras -----
    async function showAiSuggestions() {
        const typedText = commentInput.value.trim();
        if (typedText.length < 3) return;

        if (!aiSession) aiSession = await createAiSession(label);
        if (!aiSession) return;

        commentMessage.textContent = "✨ Thinking...";
        try {
            const chat = await aiSession.clone();
            const reply = await chat.prompt(
                'Finish this comment. Each suggestion MUST start with exactly: "' + typedText + '"'
            );
            chat.destroy();

            // They kept typing or left the box? Ignore this old answer.
            if (commentInput.value.trim() !== typedText) return;
            if (document.activeElement !== commentInput) return;

            suggestionBox.querySelectorAll(".ai").forEach(function (li) { li.remove(); });
            const already = Array.from(suggestionBox.children).map(function (li) {
                return li.dataset.value.toLowerCase();
            });

            reply.split("\n")
                .map(function (line) { return line.replace(/^[-*\d.\s]+/, "").trim(); })
                .filter(function (line) { return line !== "" && !already.includes(line.toLowerCase()); })
                .slice(0, 3)
                .forEach(function (idea) { addSuggestion(idea, true); });

            if (suggestionBox.children.length > 0) suggestionBox.hidden = false;
        } catch (error) {
            console.error("AI error:", error);
        } finally {
            if (commentMessage.textContent === "✨ Thinking...") commentMessage.textContent = "";
        }
    }

    // Wait until they pause typing for 0.6s, then ask the AI
    commentInput.addEventListener("input", function () {
        clearTimeout(aiTimer);
        aiTimer = setTimeout(showAiSuggestions, 600);
    });
}

// Turn on the suggester for EVERY row
document.querySelectorAll(".suggest-wrap").forEach(setupSuggester);

// ===== Average star rating =====
// Add camera, display, audio, storage, processor here when you turn those rows back on
// ===== Star ratings: individual score per row + overall average =====
// Add camera, display, audio, storage, processor here when you turn those rows back on
// ===== Overall average star rating =====
// Add camera, display, audio, storage, processor here when you turn those rows back on
const ratingNames = ["battery-life", "price-rating", "performance", "software", "durability", "service"];
const averageMessage = document.getElementById("average-rating");

function showAverage() {
    let total = 0;
    let rated = 0;

    ratingNames.forEach(function (name) {
        const chosen = document.querySelector('input[name="' + name + '"]:checked');
        if (chosen) {
            total += Number(chosen.value);
            rated++;
        }
    });

    if (rated === 0) {
        averageMessage.textContent = "No ratings yet";
        return;
    }

    averageMessage.textContent = "Overall: " + (total / rated).toFixed(1) + "/5";
}

document.querySelectorAll(".star-rating input").forEach(function (star) {
    star.addEventListener("change", showAverage);
});