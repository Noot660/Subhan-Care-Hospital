// Reusable UI component helpers

export function createModal(title, content, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;

  const body = overlay.querySelector('.modal-body');
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else {
    body.appendChild(content);
  }

  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 200);
    if (onClose) onClose();
  };

  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  return { overlay, body, close };
}

export function createCard(title, body, actions) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    ${title ? `<div class="card-header"><h4>${title}</h4></div>` : ''}
    <div class="card-body">${body}</div>
    ${actions ? `<div class="card-actions">${actions}</div>` : ''}
  `;
  return card;
}

export function createTable(headers, rows, options = {}) {
  const table = document.createElement('table');
  table.className = 'data-table ' + (options.className || '');

  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (rows.length === 0 && options.emptyMessage) {
    tbody.innerHTML = `<tr><td colspan="${headers.length}" class="text-center text-muted">${options.emptyMessage}</td></tr>`;
  } else {
    rows.forEach(row => {
      const tr = document.createElement('tr');
      if (row.onClick) tr.style.cursor = 'pointer';
      row.cells.forEach((cell, i) => {
        const td = document.createElement('td');
        if (typeof cell === 'string') {
          td.innerHTML = cell;
        } else {
          td.appendChild(cell);
        }
        tr.appendChild(td);
      });
      if (row.onClick) {
        tr.addEventListener('click', row.onClick);
        tr.classList.add('clickable');
      }
      tbody.appendChild(tr);
    });
  }
  table.appendChild(tbody);
  return table;
}

export function createFormField(label, name, type = 'text', opts = {}) {
  const div = document.createElement('div');
  div.className = 'form-field';

  const id = `field-${name}`;
  let inputHtml = '';

  if (type === 'select') {
    inputHtml = `<select id="${id}" name="${name}" ${opts.required ? 'required' : ''}>
      <option value="">Select...</option>
      ${(opts.options || []).map(o => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>`;
  } else if (type === 'textarea') {
    inputHtml = `<textarea id="${id}" name="${name}" placeholder="${opts.placeholder || ''}" ${opts.required ? 'required' : ''}>${opts.value || ''}</textarea>`;
  } else {
    inputHtml = `<input type="${type}" id="${id}" name="${name}" placeholder="${opts.placeholder || ''}" value="${opts.value || ''}" ${opts.required ? 'required' : ''}>`;
  }

  div.innerHTML = `
    <label for="${id}">${label}${opts.required ? ' <span class="required">*</span>' : ''}</label>
    ${inputHtml}
    ${opts.help ? `<small class="form-help">${opts.help}</small>` : ''}
  `;

  return div;
}

export function createStatsCard(label, value, icon, color) {
  const colors = {
    blue: '#2563eb', green: '#16a34a', red: '#dc2626',
    purple: '#7c3aed', orange: '#ea580c', teal: '#0d9488',
  };

  return `
    <div class="stats-card">
      <div class="stats-icon" style="background:${colors[color] || color || '#2563eb'}">${icon || '📊'}</div>
      <div class="stats-info">
        <span class="stats-value">${value}</span>
        <span class="stats-label">${label}</span>
      </div>
    </div>
  `;
}

export function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function showConfirm(message) {
  return new Promise((resolve) => {
    const modal = createModal('Confirm', `
      <p>${message}</p>
      <div class="flex gap-2 mt-4">
        <button class="btn btn-danger" id="confirm-yes">Yes</button>
        <button class="btn btn-secondary" id="confirm-no">Cancel</button>
      </div>
    `);

    modal.body.querySelector('#confirm-yes').addEventListener('click', () => {
      modal.close();
      resolve(true);
    });
    modal.body.querySelector('#confirm-no').addEventListener('click', () => {
      modal.close();
      resolve(false);
    });
  });
}

// Format helpers
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-PK', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatDateTime(dateStr, timeStr) {
  return `${formatDate(dateStr)} ${timeStr || ''}`;
}

export function statusBadge(status) {
  const colors = {
    scheduled: 'badge-blue',
    'checked-in': 'badge-green',
    completed: 'badge-teal',
    cancelled: 'badge-red',
    'no-show': 'badge-orange',
    active: 'badge-green',
    inactive: 'badge-red',
    pending: 'badge-orange',
    paid: 'badge-green',
    unpaid: 'badge-red',
    dispensed: 'badge-teal',
  };
  const cls = colors[status] || 'badge-gray';
  return `<span class="badge ${cls}">${status}</span>`;
}
