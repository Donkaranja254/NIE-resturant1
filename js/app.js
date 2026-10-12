// ===== SHARED UTILITIES =====

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser'));
  } catch {
    return null;
  }
}

function logout() {
  localStorage.removeItem('currentUser');
  window.location.href = 'index.html';
}

function getTodayDateStr() {
  const d = new Date();
  return d.getFullYear() + '-' + 
         String(d.getMonth() + 1).padStart(2, '0') + '-' + 
         String(d.getDate()).padStart(2, '0');
}

function getTodayMenu() {
  const menus = JSON.parse(localStorage.getItem('menus') || '{}');
  return menus[getTodayDateStr()] || null;
}

function getBookings() {
  return JSON.parse(localStorage.getItem('bookings') || '[]');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-KE', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}
