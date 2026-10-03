import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Icon from 'flarum/common/components/Icon';
import Button from 'flarum/common/components/Button';
import extractText from 'flarum/common/utils/extractText';
import classList from 'flarum/common/utils/classList';
import * as basket from './basket';
import { insertAll, pendingFor } from './quote';

const t = (key, params) => app.translator.trans(`ernestdefoe-sheaf.forum.${key}`, params);

function currentDiscussion() {
  try {
    return (app.current && app.current.get('discussion')) || null;
  } catch (e) {
    return null;
  }
}

function excerpt(text, max = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The floating "Reply with N quotes" pill. Mounted once on its own root, so it
 * never touches the discussion page's own vnode tree; it decides for itself
 * whether to show.
 */
export default class Pill extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.open = false;
    this.busy = false;
    this.onDocClick = (e) => {
      if (this.open && this.element && !this.element.contains(e.target)) {
        this.open = false;
        m.redraw();
      }
    };
    this.onKey = (e) => {
      if (this.open && e.key === 'Escape') {
        this.open = false;
        m.redraw();
        const toggle = this.element && this.element.querySelector('.Sheaf-listToggle');
        if (toggle) toggle.focus();
      }
    };
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    document.addEventListener('mousedown', this.onDocClick);
    document.addEventListener('keydown', this.onKey);
    this.measure = this.measure.bind(this);
    window.addEventListener('resize', this.measure);
    this.timer = setInterval(this.measure, 300);
    this.measure();
  }

  onremove(vnode) {
    super.onremove(vnode);
    document.removeEventListener('mousedown', this.onDocClick);
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.measure);
    clearInterval(this.timer);
  }

  /**
   * Sit above whatever is fixed to the bottom of the screen: the minimised or
   * open composer, a bottom tab bar. Hit-tests the bottom edge rather than
   * naming selectors, so a theme's own bar is covered too.
   */
  measure() {
    const el = this.element;
    if (!el || !el.firstElementChild) return;
    const h = window.innerHeight;
    let offset = 0;
    const xs = [window.innerWidth / 2, window.innerWidth / 4, (window.innerWidth * 3) / 4];
    try {
      xs.forEach((x) => {
        (document.elementsFromPoint(x, h - 2) || []).forEach((node) => {
          for (let n = node; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
            if (el.contains(n)) return;
            const pos = getComputedStyle(n).position;
            if (pos === 'fixed' || pos === 'sticky') {
              const r = n.getBoundingClientRect();
              if (r.height < h * 0.7 && r.bottom >= h - 4) offset = Math.max(offset, h - r.top);
              return;
            }
          }
        });
      });
    } catch (e) {
      offset = 0;
    }
    el.style.setProperty('--sheaf-offset', `${Math.round(offset)}px`);
  }

  view() {
    const discussion = currentDiscussion();
    const n = app.session.user ? basket.count() : 0;
    const composerCovers = app.composer.isVisible() && app.composer.isFullScreen();

    if (!discussion || !n || composerCovers) return <div className="Sheaf-root" />;

    const canReply = discussion.canReply();
    const items = basket.all();
    const pending = pendingFor(discussion.id());
    const inserted = pending && app.composer.isVisible() && pending.keys.length === items.length && items.every((i) => pending.keys.includes(i.key));

    return (
      <div className="Sheaf-root">
        <div className={classList('Sheaf-pill', this.open && 'Sheaf-pill--open')} role="region" aria-label={extractText(t('pill_label'))}>
          {this.open ? this.popover(items, discussion) : null}

          <button
            type="button"
            className="Sheaf-reply"
            disabled={!canReply || this.busy}
            title={canReply ? '' : extractText(t('cannot_reply'))}
            onclick={() => this.reply(discussion)}
          >
            <Icon name={this.busy ? 'fas fa-spinner fa-spin' : 'fas fa-quote-left'} />
            <span>{inserted ? t('inserted', { count: n }) : t('reply_with', { count: n })}</span>
          </button>

          <button
            type="button"
            className="Sheaf-iconButton Sheaf-listToggle"
            aria-expanded={this.open ? 'true' : 'false'}
            aria-controls="sheaf-list"
            aria-label={extractText(t('show_list'))}
            title={extractText(t('show_list'))}
            onclick={() => {
              this.open = !this.open;
            }}
          >
            <Icon name={this.open ? 'fas fa-chevron-down' : 'fas fa-chevron-up'} />
          </button>

          <button
            type="button"
            className="Sheaf-iconButton Sheaf-clear"
            aria-label={extractText(t('clear'))}
            title={extractText(t('clear'))}
            onclick={() => this.clear()}
          >
            <Icon name="fas fa-times" />
          </button>
        </div>
      </div>
    );
  }

  popover(items, discussion) {
    const here = String(discussion.id());

    return (
      <div className="Sheaf-popover" id="sheaf-list">
        <div className="Sheaf-popoverHead">
          {t('list_heading', { count: items.length, max: basket.maxQuotes() })}
        </div>
        <ul className="Sheaf-list">
          {items.map((i) => (
            <li className="Sheaf-item" key={i.key}>
              <div className="Sheaf-itemText">
                <div className="Sheaf-itemWho">
                  <strong>{i.author || extractText(app.translator.trans('core.lib.username.deleted_text'))}</strong>
                  <span className="Sheaf-itemNumber">#{i.number}</span>
                  {i.text ? <span className="Sheaf-tag">{t('selection')}</span> : null}
                </div>
                {i.text ? <div className="Sheaf-itemExcerpt">“{excerpt(i.text)}”</div> : null}
                {i.discussionId && String(i.discussionId) !== here ? (
                  <div className="Sheaf-itemFrom">
                    <Icon name="far fa-comments" /> {i.discussionTitle}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="Sheaf-iconButton Sheaf-remove"
                aria-label={extractText(t('remove', { name: i.author || '', number: i.number }))}
                title={extractText(t('remove', { name: i.author || '', number: i.number }))}
                onclick={() => {
                  basket.remove(i.key);
                  if (!basket.count()) this.open = false;
                }}
              >
                <Icon name="fas fa-times" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  async reply(discussion) {
    if (this.busy) return;
    this.busy = true;
    this.open = false;
    m.redraw();
    try {
      await insertAll(discussion);
    } catch (e) {
      // replyAction rejects when the member cannot reply (or a login modal
      // was shown instead). Nothing to undo: the basket is untouched.
    } finally {
      this.busy = false;
      m.redraw();
    }
  }

  clear() {
    const saved = basket.all();
    basket.clear();
    this.open = false;

    let alert;
    alert = app.alerts.show(
      {
        type: 'success',
        controls: [
          <Button
            className="Button Button--link"
            onclick={() => {
              basket.restore(saved);
              app.alerts.dismiss(alert);
            }}
          >
            {t('undo')}
          </Button>,
        ],
      },
      t('cleared')
    );
  }
}
