// Auth state management

export const auth = {
  isLoggedIn() {
    return !!sessionStorage.getItem('token');
  },

  getUser() {
    const raw = sessionStorage.getItem('user');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  getRole() {
    const user = this.getUser();
    return user ? user.role : null;
  },

  getToken() {
    return sessionStorage.getItem('token');
  },

  setSession(data) {
    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('user', JSON.stringify(data.user));
    sessionStorage.setItem('expires_at', data.expires_at);
  },

  clearSession() {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('expires_at');
  },

  async login(username, password) {
    const { api } = await import('./api.js');
    const data = await api.login(username, password);
    this.setSession(data);
    return data;
  },

  async logout() {
    const { api } = await import('./api.js');
    try { await api.logout(); } catch {}
    this.clearSession();
  },

  isExpired() {
    const exp = sessionStorage.getItem('expires_at');
    if (!exp) return false;
    return new Date(exp) < new Date();
  },

  // Default redirects per role
  getDefaultRoute(role) {
    const routes = {
      admin: '#/dashboard/admin',
      receptionist: '#/dashboard/receptionist',
      doctor: '#/dashboard/doctor',
      pharmacist: '#/dashboard/pharmacist',
      billing: '#/dashboard/billing',
      management: '#/dashboard/management',
    };
    return routes[role] || '#/dashboard';
  },
};
