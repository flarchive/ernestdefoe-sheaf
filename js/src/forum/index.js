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
import Model from 'flarum/common/Model';

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
 * Reply and edit composers save the post in the same synchronous turn as
 * onsubmit, so a flag raised for exactly that call picks out the one post save
 * whose promise says the post went through. Both hooks are plain extend /
 * override on public classes; nothing in the store is replaced.
 */
let submitting = false;

function clearOnPost() {
  const watch = (name, discussionOf) =>
    override(`flarum/forum/components/${name}`, 'onsubmit', function (original, ...args) {
      const discussion = discussionOf(this.attrs);
      submitting = !!(discussion && pendingFor(discussion.id()));
      try {
        return original(...args);
      } finally {
        submitting = false;
      }
    });

  watch('ReplyComposer', (attrs) => attrs.discussion);
  // Mentions inserts into an open EDIT composer when it is for the same
  // discussion, so a quote can be posted by saving an edit too.
  watch('EditPostComposer', (attrs) => attrs.post && attrs.post.discussion());

  extend(Model.prototype, 'save', function (promise) {
    if (!submitting || this.data.type !== 'posts' || !promise) return;
    submitting = false;
    promise.then(onPosted, () => {});
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
