module.exports = {
  provider: console,
  log: () => {},
  info: () => {},
  error: () => {},
  warn: () => {},
};

const functions = ['log', 'info', 'error', 'warn'];
functions.forEach((fn) => {
  module.exports[fn] = function() {
    const provider = module.exports.provider;
    if (provider && provider[fn]) return provider[fn].apply(provider, arguments);
  }
});
