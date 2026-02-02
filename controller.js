let currentLayout = '2x2';
let childIds = [];
let lastBounds = { left: 0, top: 0, width: 0, height: 0 };
let isUpdating = false;
const TOOLBAR_HEIGHT = 50; // Should match CSS
const GAP = 8;
const POLL_INTERVAL = 200;
const BRING_CHILDREN_TO_FRONT = true;
const DEFAULT_TARGET_URL = 'https://chatgpt.com/';
let targetUrl = DEFAULT_TARGET_URL;

async function init() {
    const data = await chrome.storage.local.get(['layout', 'childIds', 'targetUrl']);
    if (data.layout) {
        currentLayout = data.layout;
        updateLayoutButtons();
    }

    const normalizedTargetUrl = normalizeTargetUrl(data.targetUrl);
    targetUrl = normalizedTargetUrl || DEFAULT_TARGET_URL;
    if (data.targetUrl !== targetUrl) {
        await chrome.storage.local.set({ targetUrl });
    }

    const urlInput = document.getElementById('target-url');
    urlInput.value = targetUrl;
    document.getElementById('btn-save-url').addEventListener('click', saveTargetUrl);
    urlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveTargetUrl();
        }
    });

    await ensureChildren();
    startPolling();

    document.getElementById('btn-refresh').addEventListener('click', refreshAll);
    document.getElementById('btn-retile').addEventListener('click', () => tileWindows(true));
    document.getElementById('layout-2x2').addEventListener('click', () => setLayout('2x2'));
    document.getElementById('layout-1-3').addEventListener('click', () => setLayout('1+3'));
    document.getElementById('btn-close').addEventListener('click', () => window.close());
}

async function ensureChildren() {
    const data = await chrome.storage.local.get(['childIds']);
    let existingIds = data.childIds || [];
    let validatedIds = [];

    // Check which children still exist
    for (const id of existingIds) {
        try {
            await chrome.windows.get(id);
            validatedIds.push(id);
        } catch (e) {
            // Doesn't exist
        }
    }

    // Create missing children
    while (validatedIds.length < 4) {
        const win = await chrome.windows.create({
            url: targetUrl,
            type: 'popup',
            width: 400,
            height: 400
        });
        validatedIds.push(win.id);
    }

    childIds = validatedIds;
    await chrome.storage.local.set({ childIds });
    await tileWindows(true);
}

function handleChildIdsChange(newChildIds = []) {
    childIds = newChildIds;
    if (childIds.length < 4) {
        ensureChildren();
    }
}

function setLayout(layout) {
    currentLayout = layout;
    chrome.storage.local.set({ layout });
    updateLayoutButtons();
    tileWindows(true);
}

function updateLayoutButtons() {
    document.getElementById('layout-2x2').classList.toggle('active', currentLayout === '2x2');
    document.getElementById('layout-1-3').classList.toggle('active', currentLayout === '1+3');
}

async function refreshAll() {
    for (const id of childIds) {
        try {
            const tabs = await chrome.tabs.query({ windowId: id });
            if (tabs.length > 0) {
                chrome.tabs.reload(tabs[0].id);
            }
        } catch (e) { }
    }
}

async function saveTargetUrl() {
    const input = document.getElementById('target-url');
    const rawValue = input.value.trim();
    const normalized = normalizeTargetUrl(rawValue);

    if (!normalized) {
        input.value = targetUrl;
        alert('Please enter a valid URL.');
        return;
    }

    if (normalized === targetUrl) {
        input.value = targetUrl;
        return;
    }

    targetUrl = normalized;
    input.value = targetUrl;
    await chrome.storage.local.set({ targetUrl });
    await retargetChildren();
}

function normalizeTargetUrl(rawValue) {
    if (!rawValue) {
        return DEFAULT_TARGET_URL;
    }

    const candidate = rawValue.match(/^https?:\/\//i)
        ? rawValue
        : `https://${rawValue}`;

    try {
        return new URL(candidate).href;
    } catch (error) {
        return null;
    }
}

async function retargetChildren() {
    for (const id of childIds) {
        try {
            const tabs = await chrome.tabs.query({ windowId: id });
            if (tabs.length > 0) {
                await chrome.tabs.update(tabs[0].id, { url: targetUrl });
            } else {
                await chrome.tabs.create({ windowId: id, url: targetUrl });
            }
        } catch (error) {
            console.error('Failed to update child window URL', error);
        }
    }
}

async function tileWindows(force = false) {
    if (isUpdating) return;
    isUpdating = true;

    try {
        const parentBounds = getParentBounds();

        // Check if moved or resized
        if (!force &&
            parentBounds.left === lastBounds.left &&
            parentBounds.top === lastBounds.top &&
            parentBounds.width === lastBounds.width &&
            parentBounds.height === lastBounds.height) {
            return;
        }

        lastBounds = {
            left: parentBounds.left,
            top: parentBounds.top,
            width: parentBounds.width,
            height: parentBounds.height
        };

        const usableWidth = parentBounds.width - (GAP * 3);
        const usableHeight = parentBounds.height - TOOLBAR_HEIGHT - (GAP * 3);
        const startX = parentBounds.left + GAP;
        const startY = parentBounds.top + TOOLBAR_HEIGHT + GAP;

        let updates = [];

        if (currentLayout === '2x2') {
            const w = Math.floor(usableWidth / 2);
            const h = Math.floor(usableHeight / 2);

            updates = [
                { left: startX, top: startY, width: w, height: h },
                { left: startX + w + GAP, top: startY, width: w, height: h },
                { left: startX, top: startY + h + GAP, width: w, height: h },
                { left: startX + w + GAP, top: startY + h + GAP, width: w, height: h }
            ];
        } else if (currentLayout === '1+3') {
            const mainW = Math.floor(usableWidth * 0.65);
            const sideW = usableWidth - mainW;
            const sideH = Math.floor((usableHeight - (GAP * 2)) / 3);

            updates = [
                { left: startX, top: startY, width: mainW, height: usableHeight + GAP * 2 },
                { left: startX + mainW + GAP, top: startY, width: sideW, height: sideH },
                { left: startX + mainW + GAP, top: startY + sideH + GAP, width: sideW, height: sideH },
                { left: startX + mainW + GAP, top: startY + (sideH + GAP) * 2, width: sideW, height: sideH }
            ];
        }

        for (let i = 0; i < 4; i++) {
            if (childIds[i]) {
                try {
                    await chrome.windows.update(childIds[i], updates[i]);
                } catch (e) {
                    // If update fails, child might be closed
                    console.error("Failed to update child window", e);
                }
            }
        }

        if (BRING_CHILDREN_TO_FRONT && childIds.length > 0) {
            try {
                const topChildId = childIds[childIds.length - 1];
                await chrome.windows.update(topChildId, { focused: true });
            } catch (e) {
                console.error("Failed to focus child window", e);
            }
        }
    } catch (e) {
        console.error("Error in tileWindows", e);
    } finally {
        isUpdating = false;
    }
}

function getParentBounds() {
    const left = window.screenX + getHorizontalWindowInset();
    const top = window.screenY + getVerticalWindowInset();
    const width = window.innerWidth;
    const height = window.innerHeight;

    return { left, top, width, height };
}

function getHorizontalWindowInset() {
    const inset = window.outerWidth - window.innerWidth;
    return Math.max(0, Math.round(inset / 2));
}

function getVerticalWindowInset() {
    const inset = window.outerHeight - window.innerHeight;
    return Math.max(0, Math.round(inset));
}

function startPolling() {
    setInterval(tileWindows, POLL_INTERVAL);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.childIds) {
        return;
    }

    handleChildIdsChange(changes.childIds.newValue || []);
});

document.addEventListener('DOMContentLoaded', init);
