import app from 'flarum/admin/app';

const t = (key) => app.translator.trans(`ernestdefoe-sheaf.admin.${key}`);

app.initializers.add('ernestdefoe-sheaf', () => {
  app.registry.for('ernestdefoe-sheaf').registerSetting({
    setting: 'ernestdefoe-sheaf.max_quotes',
    type: 'number',
    label: t('max_quotes'),
    help: t('max_quotes_help'),
    min: 1,
    max: 50,
    placeholder: '10',
  });
});
