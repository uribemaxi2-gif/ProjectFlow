(() => {
  'use strict';
  const normalize = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const valid = value => value.length > 0 && value.length <= 60;
  const name = user => { const value = normalize(user?.user_metadata?.display_name); return valid(value) ? value : ''; };
  window.ProjectFlowProfile = Object.freeze({ normalize, valid, name });
})();
