import app from 'flarum/forum/app';
import extractText from 'flarum/common/utils/extractText';
import DiscussionControls from 'flarum/forum/utils/DiscussionControls';
import * as basket from './basket';

const t = (key, params) => app.translator.trans(`ernestdefoe-sheaf.forum.${key}`, params);

/**
 * flarum/mentions' insertMention(post, composer, quote), the function behind
 * its own Quote button (forum/utils/reply.js).
 *
 * Only that file's default export, reply(), is in the registry, and reply()
 * always opens the composer for the QUOTED post's discussion, which is wrong
 * for a quote collected from another thread. So this is insertMention
 * line for line, with the mention itself still built by mentions' own
 * formatter (app.mentionFormats), so the text is exactly what its Quote
 * button produces: `> @"Display Name"#p123 quoted text`. The post mention is
 * parsed, the quoted member is notified, and an editor that translates
 * inserted Markdown (Scribe) receives the same input it gets from mentions.
 *
 * Looked up at call time: mentions is optional, and when it is disabled
 * app.mentionFormats does not exist.
 */
function mentionsInsert() {
  let mentionable = null;
  try {
    mentionable = app.mentionFormats && app.mentionFormats.mentionable('post');
  } catch (e) {
    mentionable = null;
  }
  if (!mentionable) return null;

  return async function insertMention(post, composer, quote, separate = false) {
    await composer.editorReady();

    const mention = mentionable.replacement(post) + ' ';

    // If the composer is empty, then assume we're starting a new reply.
    // In which case we don't want the user to have to confirm if they
    // close the composer straight away.
    if (!composer.fields.content()) {
      composer.body.attrs.originalContent = mention;
    }

    const cursorPosition = composer.editor.getSelectionRange()[0];
    const preceding = composer.fields.content().slice(0, cursorPosition);
    const precedingNewlines = preceding.length == 0 ? 0 : 3 - preceding.match(/(\n{0,2})$/)[0].length;

    // The one departure from mentions: between two of OUR quotes, one more
    // blank line. Flarum's Markdown joins quotes separated by a single blank
    // line into one blockquote; two keep each quote its own block. (An editor
    // that converts inserted Markdown, like Scribe, skips blank lines and
    // already gives each insert its own quote.)
    const extra = separate && /\n\n$/.test(preceding) && !/\n\n\n$/.test(preceding) ? '\n' : '';

    composer.editor.insertAtCursor(
      extra +
        Array(precedingNewlines).join('\n') + // Insert up to two newlines, depending on preceding whitespace
        (quote ? '> ' + mention + quote.trim().replace(/\n/g, '\n> ') + '\n\n' : mention),
      false
    );

    return composer;
  };
}

export function mentionsEnabled() {
  return !!mentionsInsert();
}

/**
 * A whole post's rendered HTML back to the Markdown-ish text a quote holds.
 * Mirrors what mentions' selectedText() does for a selection (emoji to their
 * shortcode, images and links to Markdown) and adds the block structure a
 * whole post has. Quotes inside the post are dropped, as traditional forums
 * do, so quoting a reply does not nest the conversation it was replying to.
 */
export function htmlToQuoteText(html) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
  root.querySelectorAll('blockquote, script, style, iframe, .PostMention, .Post-quoteButtonContainer').forEach((el) => el.remove());

  const walk = (node, ctx = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return ctx.pre ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const inner = (extra = {}) =>
      Array.from(node.childNodes)
        .map((c) => walk(c, { ...ctx, ...extra }))
        .join('');

    switch (tag) {
      case 'br':
        return '\n';
      case 'p':
      case 'div':
        return `${inner().trim()}\n\n`;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return `**${inner().trim()}**\n\n`;
      case 'strong':
      case 'b': {
        const s = inner();
        return s.trim() ? `**${s.trim()}**` : s;
      }
      case 'em':
      case 'i': {
        const s = inner();
        return s.trim() ? `*${s.trim()}*` : s;
      }
      case 'del':
      case 's':
        return `~~${inner()}~~`;
      case 'code':
        return ctx.pre ? inner({ pre: true }) : `\`${inner()}\``;
      case 'pre':
        return `\`\`\`\n${inner({ pre: true }).replace(/\n+$/, '')}\n\`\`\`\n\n`;
      case 'ul':
      case 'ol': {
        let n = 0;
        const lines = Array.from(node.children)
          .filter((li) => li.tagName.toLowerCase() === 'li')
          .map((li) => {
            n += 1;
            const text = walk(li, ctx).trim().replace(/\n+/g, ' ');
            return tag === 'ol' ? `${n}. ${text}` : `- ${text}`;
          });
        return `${lines.join('\n')}\n\n`;
      }
      case 'li':
        return inner();
      case 'img':
        if (node.classList.contains('emoji')) return node.getAttribute('alt') || '';
        return node.getAttribute('src') ? `![](${node.src})` : '';
      case 'a': {
        const text = inner().trim();
        // A user mention's text is "@Name"; written back out it could mention
        // them again. Keep the name, not the ping.
        if (node.classList.contains('UserMention') || node.classList.contains('GroupMention')) return text.replace(/^@/, '');
        const href = node.href;
        if (!href || !text) return text;
        return text === href ? href : `[${text}](${href})`;
      }
      default:
        return inner();
    }
  };

  return walk(root)
    .split(/(```[\s\S]*?```)/)
    .map((part, i) => (i % 2 ? part : part.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Thread order: by discussion, then by post number within it. */
function threadOrder(a, b) {
  const da = parseInt(a.discussionId, 10) || 0;
  const db = parseInt(b.discussionId, 10) || 0;
  if (da !== db) return da - db;
  if (a.number !== b.number) return (a.number || 0) - (b.number || 0);
  return (a.addedAt || 0) - (b.addedAt || 0);
}

/**
 * Every post the basket needs, from the store when it is there, otherwise in
 * ONE request for all of the missing ids — never one request per quote.
 */
async function resolvePosts(list) {
  const needsContent = (i, post) => !i.text && typeof post.contentHtml() !== 'string';
  const missing = list.filter((i) => {
    const post = app.store.getById('posts', i.postId);
    return !post || needsContent(i, post);
  });

  if (missing.length) {
    const ids = Array.from(new Set(missing.map((i) => i.postId)));
    try {
      await app.store.find('posts', {
        filter: { id: ids.join(',') },
        include: 'user,discussion',
        page: { limit: ids.length },
      });
    } catch (e) {
      // Handled below: whatever did not arrive is reported as unavailable.
    }
  }

  const found = [];
  const gone = [];
  list.forEach((i) => {
    const post = app.store.getById('posts', i.postId);
    if (!post || (!i.text && typeof post.contentHtml() !== 'string')) gone.push(i);
    else found.push({ item: i, post });
  });

  return { found, gone };
}

function sourceLine(item, post) {
  const title = (item.discussionTitle || '').replace(/[[\]]/g, '');
  const label = extractText(t('source_link', { title }));
  let url;
  try {
    url = window.location.origin + app.route('discussion.near', { id: item.discussionId, near: post.number() });
  } catch (e) {
    return '';
  }
  return `[${label}](${url})`;
}

function quoteFor(item, post, targetDiscussionId) {
  let text = item.text || htmlToQuoteText(post.contentHtml());
  if (!text) text = '…';

  if (item.discussionId && String(item.discussionId) !== String(targetDiscussionId)) {
    const line = sourceLine(item, post);
    if (line) text = `${text}\n\n${line}`;
  }

  return text;
}

/**
 * Without flarum/mentions there is no mention syntax to reuse, so the quote is
 * a plain Markdown blockquote with the author's name. Same whitespace rules as
 * mentions' insertMention so the two read alike.
 */
async function plainInsert(post, composer, quote, separate = false) {
  await composer.editorReady();
  const user = post.user();
  const name = user ? user.displayName() : extractText(app.translator.trans('core.lib.username.deleted_text'));
  const head = extractText(t('plain_quote_header', { name }));

  const cursor = composer.editor.getSelectionRange()[0];
  const preceding = composer.fields.content().slice(0, cursor);
  const newlines = preceding.length === 0 ? 0 : 3 - preceding.match(/(\n{0,2})$/)[0].length;

  const extra = separate && /\n\n$/.test(preceding) && !/\n\n\n$/.test(preceding) ? '\n' : '';

  composer.editor.insertAtCursor(extra + Array(newlines).join('\n') + '> ' + head + '\n> ' + quote.trim().replace(/\n/g, '\n> ') + '\n\n', false);
  return composer;
}

/** The keys inserted into the composer that is open now, waiting for a successful post. */
let pending = null;

export function pendingFor(discussionId) {
  return pending && String(pending.discussionId) === String(discussionId) ? pending : null;
}

export function onPosted() {
  if (!pending) return;
  basket.removeMany(pending.keys);
  pending = null;
  m.redraw();
}

export function forgetPending() {
  pending = null;
}

/**
 * Open the reply composer for `discussion` (or use the one already open) and
 * insert every collected quote, in thread order.
 */
export async function insertAll(discussion) {
  const list = basket.all().sort(threadOrder);
  if (!list.length || !discussion) return;

  const { found, gone } = await resolvePosts(list);

  if (gone.length) {
    basket.removeMany(gone.map((i) => i.key));
    app.alerts.show({ type: 'warning' }, t('unavailable', { count: gone.length }));
  }
  if (!found.length) {
    m.redraw();
    return;
  }

  let composer;
  if (app.composer.bodyMatches('flarum/forum/components/EditPostComposer') && app.composer.body.attrs.post.discussion() === discussion) {
    composer = app.composer;
  } else {
    composer = await DiscussionControls.replyAction.call(discussion);
  }

  const insert = mentionsInsert() || plainInsert;

  for (let i = 0; i < found.length; i++) {
    const { item, post } = found[i];
    await insert(post, composer, quoteFor(item, post, discussion.id()), i > 0);
  }

  pending = { discussionId: discussion.id(), keys: found.map(({ item }) => item.key) };
  m.redraw();
}
