// Simple hash-based client router

const routes = {};

export const router = {
  register(pattern, handler) {
    routes[pattern] = handler;
  },

  navigate(hash) {
    window.location.hash = hash;
  },

  start() {
    const handleRoute = () => {
      const hash = window.location.hash || '#/';
      const [path, queryString] = hash.split('?');
      const params = {};
      if (queryString) {
        queryString.split('&').forEach(pair => {
          const [k, v] = pair.split('=');
          params[decodeURIComponent(k)] = decodeURIComponent(v || '');
        });
      }

      // Try exact match first, then prefix match
      let handler = routes[path];
      let matchParams = params;

      if (!handler) {
        for (const [pattern, h] of Object.entries(routes)) {
          const patternParts = pattern.split('/');
          const pathParts = path.split('/');
          if (patternParts.length !== pathParts.length) continue;

          let matched = true;
          const extracted = { ...params };
          for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
              extracted[patternParts[i].slice(1)] = pathParts[i];
            } else if (patternParts[i] !== pathParts[i]) {
              matched = false;
              break;
            }
          }
          if (matched) {
            handler = h;
            matchParams = extracted;
            break;
          }
        }
      }

      // Check auth for protected routes
      const isProtected = path.startsWith('#/dashboard');
      if (isProtected) {
        const token = sessionStorage.getItem('token');
        if (!token) {
          window.location.hash = '#/login';
          return;
        }
      }

      if (handler) {
        handler(matchParams);
      } else {
        document.getElementById('app').innerHTML = `
          <div class="error-page">
            <h1>404</h1>
            <p>Page not found</p>
            <a href="#/" class="btn btn-primary">Go Home</a>
          </div>
        `;
      }
    };

    window.addEventListener('hashchange', handleRoute);
    handleRoute(); // Initial load
  },
};
