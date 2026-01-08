let currentLayout = '2x2';
let childIds = [];
let lastBounds = { left: 0, top: 0, width: 0, height: 0 };
let isUpdating = false;
const TOOLBAR_HEIGHT = 50; // Should match CSS
const GAP = 8;
const POLL_INTERVAL = 200;

async function init() {
    const data = await chrome.storage.local.get(['layout', 'childIds']);
    if (data.layout) {
        currentLayout = data.layout;
        updateLayoutButtons();
    }

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
            url: 'https://chatgpt.com/',
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

async function tileWindows(force = false) {
    if (isUpdating) return;
    isUpdating = true;

    try {
        const parent = await chrome.windows.getCurrent();

        // Check if moved or resized
        if (!force &&
            parent.left === lastBounds.left &&
            parent.top === lastBounds.top &&
            parent.width === lastBounds.width &&
            parent.height === lastBounds.height) {
            return;
        }

        lastBounds = {
            left: parent.left,
            top: parent.top,
            width: parent.width,
            height: parent.height
        };

        const usableWidth = parent.width - (GAP * 3);
        const usableHeight = parent.height - TOOLBAR_HEIGHT - (GAP * 3);
        const startX = parent.left + GAP;
        const startY = parent.top + TOOLBAR_HEIGHT + GAP;

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
    } catch (e) {
        console.error("Error in tileWindows", e);
    } finally {
        isUpdating = false;
    }
}

function startPolling() {
    setInterval(tileWindows, POLL_INTERVAL);
}

document.addEventListener('DOMContentLoaded', init);
