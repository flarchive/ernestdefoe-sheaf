import app from 'flarum/forum/app';

/**
 * The basket: the quotes a member has collected and not yet posted.
 *
 * It lives in localStorage so it survives moving between discussions and
 * reloading the page, which is the whole point of collecting across
 * discussions. Every access is wrapped: storage can be blocked, full, or
 * throw outright in a private window, and the forum must keep working (the
 * basket just stops persisting).
 *
 * An item:
 *   key         'p{id}' for a whole post, 'p{id}:s{n}' for a selection
 *   postId      the post's id (string)
 *   discussionId, discussionTitle
 *   author      display name at the time it was collected (for the list only;
 *               the inserted mention uses the post's live author)
 *   number      the post number in its discussion
 *   text        the selected text, for a selection; absent for a whole post
 *   addedAt     ms timestamp
 */

let items = [];
let loadedFor = null;

function storageKey() {
  let base = '';
  try {
    base = app.forum.attribute('baseUrl') || '';
  } catch (e) {
    base = window.location.origin;
  }
  return `ernestdefoe-sheaf:basket:${base}`;
}

function read() {
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((i) => i && i.key && i.postId) : [];
  } catch (e) {
    return [];
  }
}

function write() {
  try {
    if (items.length) window.localStorage.setItem(storageKey(), JSON.stringify(items));
    else window.localStorage.removeItem(storageKey());
  } catch (e) {
    // Storage blocked or full: the basket still works for this page.
  }
}

function ensureLoaded() {
  const key = storageKey();
  if (loadedFor !== key) {
    items = read();
    loadedFor = key;
  }
}

/** Another tab changed the basket: pick it up. */
export function listenForOtherTabs() {
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== storageKey()) return;
      items = read();
      m.redraw();
    });
  } catch (e) {
    // no storage events; each tab keeps its own view until reload
  }
}

export function maxQuotes() {
  const n = parseInt(app.forum.attribute('sheafMaxQuotes'), 10);
  return n > 0 ? n : 10;
}

export function all() {
  ensureLoaded();
  return items.slice();
}

export function count() {
  ensureLoaded();
  return items.length;
}

export function has(key) {
  ensureLoaded();
  return items.some((i) => i.key === key);
}

export function isFull() {
  return count() >= maxQuotes();
}

function describe(post) {
  const discussion = post.discussion && post.discussion();
  const user = post.user && post.user();
  return {
    postId: String(post.id()),
    discussionId: discussion ? String(discussion.id()) : null,
    discussionTitle: discussion ? discussion.title() : '',
    author: user ? user.displayName() : '',
    number: post.number(),
  };
}

/** @returns false when the basket is full */
export function addPost(post) {
  ensureLoaded();
  const key = `p${post.id()}`;
  if (has(key)) return true;
  if (isFull()) return false;
  items.push({ key, ...describe(post), addedAt: Date.now() });
  write();
  return true;
}

/** @returns false when the basket is full */
export function addSelection(post, text) {
  ensureLoaded();
  const clean = String(text || '').trim();
  if (!clean) return true;
  const existing = items.find((i) => i.postId === String(post.id()) && i.text === clean);
  if (existing) return true;
  if (isFull()) return false;
  items.push({ key: `p${post.id()}:s${Date.now()}`, ...describe(post), text: clean, addedAt: Date.now() });
  write();
  return true;
}

export function remove(key) {
  ensureLoaded();
  items = items.filter((i) => i.key !== key);
  write();
}

export function removeMany(keys) {
  ensureLoaded();
  const drop = new Set(keys);
  items = items.filter((i) => !drop.has(i.key));
  write();
}

export function clear() {
  items = [];
  write();
}

/** Put back a basket that was just cleared (the Undo on the cleared alert). */
export function restore(saved) {
  items = Array.isArray(saved) ? saved.slice(0, maxQuotes()) : [];
  write();
  m.redraw();
}
