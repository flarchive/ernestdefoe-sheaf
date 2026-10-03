import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import CommentPost from 'flarum/forum/components/CommentPost';
import Button from 'flarum/common/components/Button';
import Icon from 'flarum/common/components/Icon';
import extractText from 'flarum/common/utils/extractText';
import classList from 'flarum/common/utils/classList';
import * as basket from './basket';
import { onPosted, forgetPending, pendingFor } from './quote';
import Pill from './Pill';

const t = (key, params) => app.translator.trans(`ernestdefoe-sheaf.forum.${key}`, params);

function canCollect(post) {
  try {
    return !!app.session.user && !post.isHidden() && post.discussion() && post.discussion().canReply();
  } catch (e) {
    return false;
  }
}

function full() {
  app.alerts.show({ type: 'error' }, t('full', { max: basket.maxQuotes() }));
}

/** The "Multi-quote" toggle beside Reply on every post. */
function addToggle() {
  extend(CommentPost.prototype, 'actionItems', function (items) {
    const post = this.attrs.post;
    if (!canCollect(post)) return;

    const key = `p${post.id()}`;
    const pressed = basket.has(key);
    const n = basket.count();

    items.add(
      'sheaf',
      <Button
        className={classList('Button Button--link SheafToggle', pressed && 'SheafToggle--on')}
        icon={pressed ? 'fas fa-check' : 'fas fa-plus'}
        aria-pressed={pressed ? 'true' : 'false'}
        title={extractText(pressed ? t('toggle_remove') : t('toggle_add'))}
        onclick={() => {
          if (pressed) basket.remove(key);
          else if (!basket.addPost(post)) full();
        }}
      >
        {t('toggle')}
        {pressed ? (
          <span className="SheafToggle-count" aria-label={extractText(t('toggle_count', { count: n }))}>
            {n}
          </span>
        ) : null}
      </Button>,
      -5
    );
  });
}

/**
 * "Add to multi-quote" beside flarum/mentions' Quote button on the popup that
 * appears over selected text. Extended by registry path: mentions is optional,
 * and when it is disabled this never fires.
 */
function addSelectionButton() {
  override('ext:flarum/mentions/forum/fragments/PostQuoteButton', 'view', function (original) {
    const vdom = original();
    if (!this.post || !canCollect(this.post)) return vdom;

    // The original root carries the positioning class; move it to a wrapper
    // so both buttons travel together when mentions positions the popup.
    vdom.attrs.className = 'Button PostQuoteButton-quote';

    return (
      <div className="PostQuoteButton SheafQuoteGroup" role="group">
        {vdom}
        <button
          type="button"
          className="Button SheafQuoteGroup-add"
          onclick={() => {
            const ok = basket.addSelection(this.post, this.content);
            this.hide();
            try {
              window.getSelection().removeAllRanges();
            } catch (e) {
              // nothing selected any more
            }
            if (!ok) full();
            m.redraw();
          }}
        >
          <Icon name="fas fa-plus" className="Button-icon" />
          {t('add_selection')}
        </button>
      </div>
    );
  });
}

/**
 * Clear what was inserted once the reply is actually POSTED — not when it is
 * inserted, so a draft that is abandoned does not lose the collection.
 *
 * ReplyComposer.onsubmit creates the post record and saves it in the same
 * synchronous turn; the save's promise is the one place that knows the post
 * went through. Wrapping createRecord for exactly that call catches it
 * without copying the method.
 */
function clearOnPost() {
  override('flarum/forum/components/ReplyComposer', 'onsubmit', function (original, ...args) {
    const discussion = this.attrs.discussion;
    if (!discussion || !pendingFor(discussion.id())) return original(...args);

    const store = app.store;
    const create = store.createRecord;
    store.createRecord = function (type, ...rest) {
      store.createRecord = create;
      const record = create.call(this, type, ...rest);
      if (type === 'posts') {
        const save = record.save;
        record.save = function (...saveArgs) {
          return save.apply(this, saveArgs).then((post) => {
            onPosted();
            return post;
          });
        };
      }
      return record;
    };

    try {
      return original(...args);
    } finally {
      store.createRecord = create;
    }
  });

  // Mentions inserts into an open EDIT composer when it is for the same
  // discussion, so a quote can be posted by saving an edit too.
  override('flarum/forum/components/EditPostComposer', 'onsubmit', function (original, ...args) {
    const post = this.attrs.post;
    const discussion = post && post.discussion();
    if (!discussion || !pendingFor(discussion.id())) return original(...args);

    const save = post.save;
    post.save = function (...saveArgs) {
      post.save = save;
      return save.apply(this, saveArgs).then((saved) => {
        onPosted();
        return saved;
      });
    };

    try {
      return original(...args);
    } finally {
      post.save = save;
    }
  });
}

function mountPill() {
  let root = document.getElementById('sheaf-pill');
  if (!root) {
    root = document.createElement('div');
    root.id = 'sheaf-pill';
    document.body.appendChild(root);
  }
  m.mount(root, Pill);
}

app.initializers.add('ernestdefoe-sheaf', () => {
  const steps = [addToggle, addSelectionButton, clearOnPost, basket.listenForOtherTabs];
  steps.forEach((step) => {
    try {
      step();
    } catch (e) {
      console.error('[sheaf]', e);
    }
  });

  // A composer closed without posting: the quotes stay collected, but they are
  // no longer "in a reply".
  try {
    extend('flarum/forum/states/ComposerState', 'hide', () => forgetPending());
  } catch (e) {
    // pending is only a label hint
  }

  extend(app, 'mount', () => {
    try {
      mountPill();
    } catch (e) {
      console.error('[sheaf]', e);
    }
  });
});
