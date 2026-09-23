/**
 * Group Expense & Donation Tracker
 * Core Application Engine with Supabase Sync & Split Ledger Math
 */

// Application State
const state = {
  supabase: null,
  isSupabaseConfigured: false,
  currentServer: null, // { id, username }
  members: [],         // [{ id, name }]
  transactions: []     // [{ id, person_name, type, amount, purpose, created_at }]
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initSupabase();
  setupLiveSplitPreview();
  checkPersistedSession();
});

// Preconfigured Supabase Credentials
const CONFIG_SUPABASE_URL = 'https://qxkmcrwhmnbaucnqmkle.supabase.co';
const CONFIG_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4a21jcndobW5iYXVjbnFta2xlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxOTExODEsImV4cCI6MjEwNTc2NzE4MX0.K49eZM9zIUeJ5Hs0cZoIbl5nPvKJNgHTkATyAej6Y0s';

// ============================================================
// SUPABASE CLIENT SETUP
// ============================================================
function initSupabase() {
  if (CONFIG_SUPABASE_URL && CONFIG_SUPABASE_KEY && window.supabase) {
    try {
      state.supabase = window.supabase.createClient(CONFIG_SUPABASE_URL, CONFIG_SUPABASE_KEY);
      state.isSupabaseConfigured = true;
      return;
    } catch (e) {
      console.warn('Failed to initialize Supabase client', e);
    }
  }

  // Fallback to Local Demo
  state.supabase = null;
  state.isSupabaseConfigured = false;
}

// ============================================================
// AUTH & SERVER CREATION / JOINING
// ============================================================

function switchAuthTab(tab) {
  const tabCreate = document.getElementById('tab-create-btn');
  const tabJoin = document.getElementById('tab-join-btn');
  const createForm = document.getElementById('create-server-form');
  const joinForm = document.getElementById('join-server-form');
  const alertBox = document.getElementById('auth-alert');

  alertBox.style.display = 'none';

  if (tab === 'create') {
    tabCreate.classList.add('active');
    tabJoin.classList.remove('active');
    createForm.style.display = 'block';
    joinForm.style.display = 'none';
  } else {
    tabJoin.classList.add('active');
    tabCreate.classList.remove('active');
    createForm.style.display = 'none';
    joinForm.style.display = 'block';
  }
}

function showAuthAlert(message) {
  const alertBox = document.getElementById('auth-alert');
  const msgEl = document.getElementById('auth-alert-msg');
  msgEl.textContent = message;
  alertBox.style.display = 'flex';
}

function hideAuthAlert() {
  const alertBox = document.getElementById('auth-alert');
  alertBox.style.display = 'none';
}

// Simple deterministic hash for room passwords
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

// CREATE SERVER
async function handleCreateServer(e) {
  e.preventDefault();
  hideAuthAlert();

  const usernameInput = document.getElementById('create-server-username').value.trim().toLowerCase();
  const passwordInput = document.getElementById('create-server-password').value;

  if (!usernameInput || !passwordInput) {
    showAuthAlert('Please provide both username and password.');
    return;
  }

  // Store real password directly as requested
  const realPassword = passwordInput;

  if (state.isSupabaseConfigured && state.supabase) {
    try {
      // 1. Check if server username already exists
      const { data: existing, error: checkErr } = await state.supabase
        .from('servers')
        .select('id')
        .eq('username', usernameInput)
        .maybeSingle();

      if (checkErr && checkErr.code !== 'PGRST116') {
        console.error(checkErr);
      }

      if (existing) {
        showAuthAlert('username is taken, try different');
        return;
      }

      // 2. Insert new server with real password
      const { data: newServer, error: insertErr } = await state.supabase
        .from('servers')
        .insert([{ username: usernameInput, password_hash: realPassword }])
        .select()
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          showAuthAlert('username is taken, try different');
          return;
        }
        throw insertErr;
      }

      enterServer({ id: newServer.id, username: newServer.username });
      showToast(`Server "${usernameInput}" created successfully!`, 'success');
      return;
    } catch (err) {
      console.error(err);
      showAuthAlert('Supabase Error: ' + (err.message || 'Failed to create server'));
      return;
    }
  }

  // Local Storage Mode
  const localServers = JSON.parse(localStorage.getItem('split_local_servers') || '{}');
  if (localServers[usernameInput]) {
    showAuthAlert('username is taken, try different');
    return;
  }

  const serverId = 'srv_' + Date.now();
  localServers[usernameInput] = {
    id: serverId,
    username: usernameInput,
    password_hash: realPassword,
    created_at: new Date().toISOString()
  };
  localStorage.setItem('split_local_servers', JSON.stringify(localServers));

  enterServer({ id: serverId, username: usernameInput });
  showToast(`Server "${usernameInput}" created in demo mode!`, 'success');
}

// JOIN SERVER
async function handleJoinServer(e) {
  e.preventDefault();
  hideAuthAlert();

  const usernameInput = document.getElementById('join-server-username').value.trim().toLowerCase();
  const passwordInput = document.getElementById('join-server-password').value;

  if (!usernameInput || !passwordInput) {
    showAuthAlert('Please provide both username and password.');
    return;
  }

  if (state.isSupabaseConfigured && state.supabase) {
    try {
      const { data: server, error } = await state.supabase
        .from('servers')
        .select('id, username, password_hash')
        .eq('username', usernameInput)
        .maybeSingle();

      if (error || !server) {
        showAuthAlert('Server not found. Please check username.');
        return;
      }

      // Check real password (or hash for backwards compatibility with earlier rooms)
      if (server.password_hash !== passwordInput && server.password_hash !== simpleHash(passwordInput)) {
        showAuthAlert('Incorrect server password.');
        return;
      }

      enterServer({ id: server.id, username: server.username });
      showToast(`Joined server "${usernameInput}"!`, 'success');
      return;
    } catch (err) {
      console.error(err);
      showAuthAlert('Supabase Error: ' + (err.message || 'Failed to join server'));
      return;
    }
  }

  // Local Storage Mode
  const localServers = JSON.parse(localStorage.getItem('split_local_servers') || '{}');
  const server = localServers[usernameInput];

  if (!server) {
    showAuthAlert('Server not found. Please check username.');
    return;
  }

  if (server.password_hash !== passwordInput && server.password_hash !== simpleHash(passwordInput)) {
    showAuthAlert('Incorrect server password.');
    return;
  }

  enterServer({ id: server.id, username: server.username });
  showToast(`Joined server "${usernameInput}"!`, 'success');
}

function enterServer(server) {
  state.currentServer = server;
  sessionStorage.setItem('split_active_server', JSON.stringify(server));

  document.getElementById('landing-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'block';
  document.getElementById('active-server-badge').style.display = 'flex';
  document.getElementById('current-server-display').textContent = '@' + server.username;

  loadServerData(server.id);
}

document.getElementById('leave-server-btn').addEventListener('click', () => {
  state.currentServer = null;
  state.members = [];
  state.transactions = [];
  sessionStorage.removeItem('split_active_server');

  document.getElementById('dashboard-view').style.display = 'none';
  document.getElementById('active-server-badge').style.display = 'none';
  document.getElementById('landing-view').style.display = 'block';
  showToast('Exited server', 'info');
});

// DELETE SERVER
async function handleDeleteServer() {
  if (!state.currentServer) return;

  const serverName = state.currentServer.username;

  const confirmFirst = confirm(`⚠️ Are you sure you want to permanently delete server "@${serverName}"?\n\nAll members, expenses, and transactions in this server will be wiped. This action cannot be undone.`);
  if (!confirmFirst) return;

  const enteredPass = prompt(`Please enter the password for "@${serverName}" to confirm deletion:`);
  if (enteredPass === null) return; // User pressed Cancel

  if (state.isSupabaseConfigured && state.supabase) {
    try {
      const { data: server, error: fetchErr } = await state.supabase
        .from('servers')
        .select('password_hash')
        .eq('id', state.currentServer.id)
        .single();

      if (fetchErr || !server) {
        showToast('Could not verify server.', 'error');
        return;
      }

      if (server.password_hash !== enteredPass && server.password_hash !== simpleHash(enteredPass)) {
        showToast('Incorrect server password. Deletion cancelled.', 'error');
        return;
      }

      // Delete transactions and members first for 100% clean deletion, then server
      await state.supabase.from('transactions').delete().eq('server_id', state.currentServer.id);
      await state.supabase.from('members').delete().eq('server_id', state.currentServer.id);
      
      const { error: delErr } = await state.supabase
        .from('servers')
        .delete()
        .eq('id', state.currentServer.id);

      if (delErr) throw delErr;

      finishServerDeletion(serverName);
      return;
    } catch (err) {
      console.error(err);
      showToast('Error deleting server from Supabase: ' + err.message, 'error');
      return;
    }
  }

  // Local Storage Mode
  const localServers = JSON.parse(localStorage.getItem('split_local_servers') || '{}');
  const server = localServers[serverName];
  if (server) {
    if (server.password_hash !== enteredPass && server.password_hash !== simpleHash(enteredPass)) {
      showToast('Incorrect server password. Deletion cancelled.', 'error');
      return;
    }
    delete localServers[serverName];
    localStorage.setItem('split_local_servers', JSON.stringify(localServers));
    localStorage.removeItem(`split_members_${state.currentServer.id}`);
    localStorage.removeItem(`split_txs_${state.currentServer.id}`);
  }

  finishServerDeletion(serverName);
}

function finishServerDeletion(serverName) {
  state.currentServer = null;
  state.members = [];
  state.transactions = [];
  sessionStorage.removeItem('split_active_server');

  document.getElementById('dashboard-view').style.display = 'none';
  document.getElementById('active-server-badge').style.display = 'none';
  document.getElementById('landing-view').style.display = 'block';

  showToast(`Server "@${serverName}" has been permanently deleted.`, 'info');
}

function checkPersistedSession() {
  const saved = sessionStorage.getItem('split_active_server');
  if (saved) {
    try {
      const server = JSON.parse(saved);
      if (server && server.id && server.username) {
        enterServer(server);
      }
    } catch (e) {}
  }
}

// ============================================================
// DATA LOADING (MEMBERS & TRANSACTIONS)
// ============================================================
async function loadServerData(serverId) {
  if (state.isSupabaseConfigured && state.supabase) {
    try {
      // Fetch members
      const { data: members, error: memErr } = await state.supabase
        .from('members')
        .select('*')
        .eq('server_id', serverId)
        .order('created_at', { ascending: true });

      if (memErr) throw memErr;
      state.members = members || [];

      // Fetch transactions
      const { data: txs, error: txErr } = await state.supabase
        .from('transactions')
        .select('*')
        .eq('server_id', serverId)
        .order('created_at', { ascending: false });

      if (txErr) throw txErr;
      state.transactions = txs || [];

      renderAll();
      return;
    } catch (err) {
      console.error('Error fetching data from Supabase:', err);
      showToast('Error syncing with Supabase: ' + err.message, 'error');
    }
  }

  // Local Storage Mode
  const localMembers = JSON.parse(localStorage.getItem(`split_members_${serverId}`) || '[]');
  const localTxs = JSON.parse(localStorage.getItem(`split_txs_${serverId}`) || '[]');

  state.members = localMembers;
  state.transactions = localTxs;

  renderAll();
}

// ============================================================
// MEMBER MANAGEMENT
// ============================================================
async function handleAddMember(e) {
  e.preventDefault();
  const input = document.getElementById('new-member-name');
  const name = input.value.trim();

  if (!name) return;

  // Check duplicate inside server
  const exists = state.members.some(m => m.name.toLowerCase() === name.toLowerCase());
  if (exists) {
    showToast(`Member "${name}" already exists in this server!`, 'error');
    return;
  }

  if (state.isSupabaseConfigured && state.supabase) {
    try {
      const { data, error } = await state.supabase
        .from('members')
        .insert([{ server_id: state.currentServer.id, name: name }])
        .select()
        .single();

      if (error) throw error;
      state.members.push(data);
      input.value = '';
      renderAll();
      showToast(`Added member: ${name}`, 'success');
      return;
    } catch (err) {
      showToast('Failed to add member to Supabase: ' + err.message, 'error');
      return;
    }
  }

  // Local Mode
  const newMember = {
    id: 'mem_' + Date.now(),
    server_id: state.currentServer.id,
    name: name,
    created_at: new Date().toISOString()
  };
  state.members.push(newMember);
  localStorage.setItem(`split_members_${state.currentServer.id}`, JSON.stringify(state.members));
  input.value = '';
  renderAll();
  showToast(`Added member: ${name}`, 'success');
}

async function removeMember(memberId, memberName) {
  // Check if member has transactions
  const hasTx = state.transactions.some(tx => tx.person_name === memberName);
  if (hasTx) {
    showToast(`Cannot remove "${memberName}" because transactions exist in their name. Delete those transactions first.`, 'error');
    return;
  }

  if (!confirm(`Are you sure you want to remove ${memberName}?`)) return;

  if (state.isSupabaseConfigured && state.supabase) {
    try {
      const { error } = await state.supabase
        .from('members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
      state.members = state.members.filter(m => m.id !== memberId);
      renderAll();
      showToast(`Removed member ${memberName}`, 'info');
      return;
    } catch (err) {
      showToast('Error removing member: ' + err.message, 'error');
      return;
    }
  }

  // Local Mode
  state.members = state.members.filter(m => m.id !== memberId);
  localStorage.setItem(`split_members_${state.currentServer.id}`, JSON.stringify(state.members));
  renderAll();
  showToast(`Removed member ${memberName}`, 'info');
}

// ============================================================
// TRANSACTION MANAGEMENT & CORE MATHEMATICS
// ============================================================

function updateTypeSelection(type) {
  const outgoingCard = document.getElementById('label-type-outgoing');
  const incomingCard = document.getElementById('label-type-incoming');

  if (type === 'outgoing') {
    outgoingCard.className = 'type-radio-card selected-outgoing';
    incomingCard.className = 'type-radio-card';
  } else {
    outgoingCard.className = 'type-radio-card';
    incomingCard.className = 'type-radio-card selected-incoming';
  }
  updateSplitPreview();
}

function setupLiveSplitPreview() {
  const amountInput = document.getElementById('tx-amount');
  if (amountInput) {
    amountInput.addEventListener('input', updateSplitPreview);
  }
}

function updateSplitPreview() {
  const amountVal = parseFloat(document.getElementById('tx-amount').value);
  const previewEl = document.getElementById('split-formula-preview');
  const memberCount = state.members.length;
  const isIncoming = document.querySelector('input[name="tx-type"]:checked').value === 'incoming';

  if (!amountVal || amountVal <= 0) {
    previewEl.innerHTML = memberCount > 0 
      ? `Splits equally among <strong>${memberCount} members</strong>.` 
      : `Please add members first.`;
    return;
  }

  if (memberCount === 0) {
    previewEl.innerHTML = `<span style="color: var(--rose);">⚠️ You need at least 1 member to split transactions.</span>`;
    return;
  }

  const share = (amountVal / memberCount).toFixed(2);
  const netDiff = (amountVal - share).toFixed(2);

  if (isIncoming) {
    previewEl.innerHTML = `<strong>Incoming Donation:</strong> Share = ${share} Tk/person. Person receiving gets debit <strong>-${netDiff} Tk</strong>; other members receive <strong>+${share} Tk</strong>.`;
  } else {
    previewEl.innerHTML = `<strong>Outgoing Expense:</strong> Share = ${share} Tk/person. Person paying gets credit <strong>+${netDiff} Tk</strong>; other members owe <strong>-${share} Tk</strong>.`;
  }
}

async function handleRecordTransaction(e) {
  e.preventDefault();

  if (state.members.length === 0) {
    showToast('Please add at least one member to the server first!', 'error');
    return;
  }

  const personName = document.getElementById('tx-person-select').value;
  const type = document.querySelector('input[name="tx-type"]:checked').value;
  const purpose = document.getElementById('tx-purpose').value.trim();
  const amount = parseFloat(document.getElementById('tx-amount').value);

  if (!personName) {
    showToast('Please select a member.', 'error');
    return;
  }

  if (!amount || amount <= 0) {
    showToast('Amount must be greater than 0 Tk.', 'error');
    return;
  }

  if (!purpose) {
    showToast('Please enter a purpose.', 'error');
    return;
  }

  const newTx = {
    server_id: state.currentServer.id,
    person_name: personName,
    type: type,
    amount: amount,
    purpose: purpose,
    created_at: new Date().toISOString()
  };

  if (state.isSupabaseConfigured && state.supabase) {
    try {
      const { data, error } = await state.supabase
        .from('transactions')
        .insert([newTx])
        .select()
        .single();

      if (error) throw error;
      state.transactions.unshift(data);
      finishTransactionSubmit();
      return;
    } catch (err) {
      showToast('Error recording transaction in Supabase: ' + err.message, 'error');
      return;
    }
  }

  // Local Mode
  newTx.id = 'tx_' + Date.now();
  state.transactions.unshift(newTx);
  localStorage.setItem(`split_txs_${state.currentServer.id}`, JSON.stringify(state.transactions));
  finishTransactionSubmit();
}

function finishTransactionSubmit() {
  document.getElementById('tx-purpose').value = '';
  document.getElementById('tx-amount').value = '';
  updateSplitPreview();
  renderAll();
  showToast('Transaction recorded successfully!', 'success');
}

async function deleteTransaction(txId) {
  if (!confirm('Are you sure you want to delete this transaction record?')) return;

  if (state.isSupabaseConfigured && state.supabase) {
    try {
      const { error } = await state.supabase
        .from('transactions')
        .delete()
        .eq('id', txId);

      if (error) throw error;
      state.transactions = state.transactions.filter(t => t.id !== txId);
      renderAll();
      showToast('Transaction deleted', 'info');
      return;
    } catch (err) {
      showToast('Error deleting transaction: ' + err.message, 'error');
      return;
    }
  }

  // Local Mode
  state.transactions = state.transactions.filter(t => t.id !== txId);
  localStorage.setItem(`split_txs_${state.currentServer.id}`, JSON.stringify(state.transactions));
  renderAll();
  showToast('Transaction deleted', 'info');
}

// ============================================================
// BALANCE CALCULATION ENGINE
// ============================================================
/**
 * Exact Ledger Formulation:
 * For each transaction with N total members:
 * - OUTGOING (Expense paid by P):
 *   share = amount / N
 *   P gets: +(amount - share)
 *   Everyone else gets: -share
 *
 * - INCOMING (Donation collected in hand by P):
 *   share = amount / N
 *   P gets: -(amount - share)
 *   Everyone else gets: +share
 */
function calculateBalances() {
  const memberNames = state.members.map(m => m.name);
  const N = memberNames.length;

  const balances = {};
  const stats = {};

  memberNames.forEach(name => {
    balances[name] = 0;
    stats[name] = { paidOutgoing: 0, receivedIncoming: 0 };
  });

  if (N === 0) return { balances, stats };

  // Calculate from all transactions in server
  state.transactions.forEach(tx => {
    const amount = Number(tx.amount);
    const share = amount / N;
    const actor = tx.person_name;

    if (tx.type === 'outgoing') {
      if (stats[actor]) stats[actor].paidOutgoing += amount;

      memberNames.forEach(name => {
        if (name === actor) {
          balances[name] += (amount - share);
        } else {
          balances[name] -= share;
        }
      });
    } else if (tx.type === 'incoming') {
      if (stats[actor]) stats[actor].receivedIncoming += amount;

      memberNames.forEach(name => {
        if (name === actor) {
          balances[name] -= (amount - share);
        } else {
          balances[name] += share;
        }
      });
    }
  });

  return { balances, stats };
}

// ============================================================
// SETTLE UP RESOLUTION ALGORITHM
// ============================================================
function computeSettlements(balances) {
  const debtors = [];
  const creditors = [];

  for (const [name, balance] of Object.entries(balances)) {
    const rounded = Math.round(balance * 100) / 100;
    if (rounded < -0.01) {
      debtors.push({ name, amount: -rounded });
    } else if (rounded > 0.01) {
      creditors.push({ name, amount: rounded });
    }
  }

  // Sort descending
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0.01) {
      transfers.push({
        from: debtor.name,
        to: creditor.name,
        amount: amount.toFixed(2)
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount < 0.01) dIdx++;
    if (creditor.amount < 0.01) cIdx++;
  }

  return transfers;
}

// ============================================================
// RENDERERS
// ============================================================
function renderAll() {
  renderMembers();
  renderDropdown();
  renderBalances();
  renderLedger();
  updateSplitPreview();

  document.getElementById('stats-member-count').textContent = state.members.length;
  document.getElementById('stats-tx-count').textContent = state.transactions.length;
  document.getElementById('member-badge').textContent = `${state.members.length} Members`;
}

function renderMembers() {
  const container = document.getElementById('members-list-container');
  if (state.members.length === 0) {
    container.innerHTML = `<span style="color: var(--text-dim); font-size: 0.85rem; align-self: center;">No members added yet. Add at least 2 members to begin.</span>`;
    return;
  }

  container.innerHTML = state.members.map(m => `
    <div class="member-pill">
      <div class="member-avatar">${m.name.charAt(0).toUpperCase()}</div>
      <span>${escapeHtml(m.name)}</span>
      <button type="button" class="remove-member-btn" onclick="removeMember('${m.id}', '${escapeHtml(m.name)}')" title="Remove member">&times;</button>
    </div>
  `).join('');
}

function renderDropdown() {
  const select = document.getElementById('tx-person-select');
  const currentVal = select.value;

  select.innerHTML = '<option value="" disabled selected>-- Select Member --</option>' +
    state.members.map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');

  if (state.members.some(m => m.name === currentVal)) {
    select.value = currentVal;
  }
}

function renderBalances() {
  const { balances, stats } = calculateBalances();
  const grid = document.getElementById('balance-grid-container');
  const settlementList = document.getElementById('settlement-list');

  if (state.members.length === 0) {
    grid.innerHTML = `<p style="color: var(--text-dim); font-size: 0.9rem;">Add members to see individual ledger balances.</p>`;
    settlementList.innerHTML = `<span style="color: var(--text-dim); font-size: 0.85rem;">No members in room yet.</span>`;
    return;
  }

  grid.innerHTML = Object.entries(balances).map(([name, netBalance]) => {
    const net = Math.round(netBalance * 100) / 100;
    let cardClass = 'neutral';
    let tagClass = 'tag-neutral';
    let amountClass = 'amount-neutral';
    let statusText = 'Settled';
    let formattedAmount = `${Math.abs(net).toFixed(2)} Tk`;
    let subtext = 'Balance is completely settled';

    if (net > 0.01) {
      cardClass = 'credit';
      tagClass = 'tag-credit';
      amountClass = 'amount-credit';
      statusText = 'Will Receive';
      formattedAmount = `+${net.toFixed(2)} Tk`;
      subtext = 'Group owes this member';
    } else if (net < -0.01) {
      cardClass = 'debt';
      tagClass = 'tag-debt';
      amountClass = 'amount-debt';
      statusText = 'Needs to Pay';
      formattedAmount = `${net.toFixed(2)} Tk`;
      subtext = 'This member owes the group';
    }

    const memberStats = stats[name] || { paidOutgoing: 0, receivedIncoming: 0 };

    return `
      <div class="balance-card ${cardClass}">
        <div class="balance-header">
          <div class="balance-user">
            <div class="member-avatar">${name.charAt(0).toUpperCase()}</div>
            <span>${escapeHtml(name)}</span>
          </div>
          <span class="balance-status-tag ${tagClass}">${statusText}</span>
        </div>
        <div class="balance-amount ${amountClass}">${formattedAmount}</div>
        <div class="balance-subtext">${subtext}</div>
        <div style="margin-top: 10px; font-size: 0.72rem; color: var(--text-dim); border-top: 1px dashed var(--border-subtle); padding-top: 6px;">
          Paid out: <strong>${memberStats.paidOutgoing.toFixed(0)} Tk</strong> | Collected in: <strong>${memberStats.receivedIncoming.toFixed(0)} Tk</strong>
        </div>
      </div>
    `;
  }).join('');

  // Render Settlement Recommendations
  const settlements = computeSettlements(balances);
  if (settlements.length === 0) {
    settlementList.innerHTML = `<span style="color: var(--emerald); font-size: 0.85rem;">🎉 All members are fully settled! No payments needed.</span>`;
  } else {
    settlementList.innerHTML = settlements.map(s => `
      <div class="settle-item">
        <div>
          <strong style="color: #fca5a5;">${escapeHtml(s.from)}</strong>
          <span class="settle-arrow">➔ pays ➔</span>
          <strong style="color: #86efac;">${escapeHtml(s.to)}</strong>
        </div>
        <div style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #fff;">
          ${s.amount} Tk
        </div>
      </div>
    `).join('');
  }
}

function renderLedger() {
  const tbody = document.getElementById('ledger-tbody');
  const countBadge = document.getElementById('ledger-count-badge');
  countBadge.textContent = `${state.transactions.length} Records`;

  if (state.transactions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 24px;">
          No transactions recorded yet in this server.
        </td>
      </tr>
    `;
    return;
  }

  const N = state.members.length;

  tbody.innerHTML = state.transactions.map(tx => {
    const isOut = tx.type === 'outgoing';
    const typeLabel = isOut ? '📤 Outgoing' : '📥 Incoming';
    const tagClass = isOut ? 'outgoing' : 'incoming';
    const amountVal = Number(tx.amount);
    const shareVal = N > 0 ? (amountVal / N).toFixed(2) : '-';
    const dateFormatted = new Date(tx.created_at).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <tr>
        <td style="color: var(--text-dim); font-size: 0.8rem;">${dateFormatted}</td>
        <td><strong>${escapeHtml(tx.person_name)}</strong></td>
        <td><span class="type-tag ${tagClass}">${typeLabel}</span></td>
        <td>${escapeHtml(tx.purpose)}</td>
        <td class="amount-cell" style="color: ${isOut ? 'var(--rose)' : 'var(--emerald)'};">
          ${amountVal.toFixed(2)} Tk
        </td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">
          ${shareVal} Tk / person
        </td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="deleteTransaction('${tx.id}')" title="Delete record">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
// EXPORT DATA
// ============================================================
function exportDataJSON() {
  if (!state.currentServer) return;
  const backup = {
    server: state.currentServer,
    members: state.members,
    transactions: state.transactions,
    exported_at: new Date().toISOString()
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
  const dlAnchor = document.createElement('a');
  dlAnchor.setAttribute("href", dataStr);
  dlAnchor.setAttribute("download", `server_${state.currentServer.username}_backup.json`);
  dlAnchor.click();
  showToast('Exported server backup JSON', 'success');
}

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
