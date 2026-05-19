/**
 * PlombTrack — Application Vue 3 (Options API)
 */
const { createApp } = Vue;

const STORAGE_KEY = 'plombtrack-storage-v2';
const AUTH_KEY = 'plombtrack-auth-v1';
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000/api' : '/api';
const INTERVENTION_STATUSES = ['Planifié', 'En cours', 'Terminé', 'Annulé'];
const INTERVENTION_TYPES = { CHAUDIERE: 'chaudiere', BRULEUR: 'bruleur' };
const CURRENT_DATA_YEAR = 2026;

function parseInterventionSequence(id) {
    if (typeof id !== 'string') return 0;
    const match = id.trim().match(/^INT-(\d+)$/i);
    return match ? Number(match[1]) : 0;
}

function formatInterventionId(sequence) {
    return `INT-${sequence}`;
}

function nextInterventionSequence(interventions) {
    const max = (Array.isArray(interventions) ? interventions : [])
        .reduce((highest, item) => Math.max(highest, parseInterventionSequence(item.id)), 0);
    return max + 1;
}

function allocateInterventionId(interventions) {
    return formatInterventionId(nextInterventionSequence(interventions));
}

function parseContractSchedules(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return {
            chaudiereDates: uniqueSortedDates(raw.chaudiereDates || raw.chaudiere || []),
            bruleurDates: uniqueSortedDates(raw.bruleurDates || raw.bruleur || []),
        };
    }

    const legacyDates = uniqueSortedDates(Array.isArray(raw) ? raw : []);
    return {
        chaudiereDates: legacyDates,
        bruleurDates: [],
    };
}

function contractAllDates(contract) {
    return uniqueSortedDates([
        ...(contract.chaudiereDates || []),
        ...(contract.bruleurDates || []),
    ]);
}

function contractTotalInterventions(contract) {
    return (contract.chaudiereDates?.length || 0) + (contract.bruleurDates?.length || 0);
}

function interventionTypeLabel(type) {
    if (type === INTERVENTION_TYPES.BRULEUR) return 'Brûleur';
    if (type === INTERVENTION_TYPES.CHAUDIERE) return 'Chaudière';
    return '—';
}

function defaultInterventionFilterRange(year = new Date().getFullYear()) {
    return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
    };
}

function formatDateInput(value) {
    if (!value) return '';
    return new Date(value).toISOString().slice(0, 10);
}

function addDays(dateString, days) {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function uniqueSortedDates(dates) {
    return [...new Set(dates)].sort((left, right) => new Date(left) - new Date(right));
}

function generateAutomaticDates(start, end, total) {
    const count = Number(total) || 0;

    if (!start || count <= 0) return [];
    if (count === 1) return [formatDateInput(start)];

    const startDate = formatDateInput(start);
    const endDate = end ? formatDateInput(end) : startDate;
    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();

    if (Number.isNaN(startTime) || Number.isNaN(endTime)) return [];

    const dayMs = 24 * 60 * 60 * 1000;
    const rangeDays = Math.max(0, Math.round((endTime - startTime) / dayMs));

    if (rangeDays === 0) {
        return Array.from({ length: count }, (_, index) => addDays(startDate, index * 7));
    }

    const dates = [];
    let previousOffset = -1;

    for (let index = 0; index < count; index += 1) {
        let offset = Math.round((rangeDays * index) / (count - 1));
        if (offset <= previousOffset) offset = previousOffset + 1;
        dates.push(addDays(startDate, offset));
        previousOffset = offset;
    }

    return uniqueSortedDates(dates);
}

function parseManualDates(value) {
    if (!value) return [];

    const matches = value
        .split(/[\n,;]+/)
        .map(item => item.trim())
        .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item));

    return uniqueSortedDates(matches);
}

function moveDateToYear(value, year = CURRENT_DATA_YEAR) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    return `${year}${value.slice(4)}`;
}

function moveDatesToYear(values, year = CURRENT_DATA_YEAR) {
    return uniqueSortedDates(
        (Array.isArray(values) ? values : [])
            .map(value => moveDateToYear(value, year))
            .filter(Boolean)
    );
}

function defaultInterventionStatus(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const interventionDate = new Date(date);
    interventionDate.setHours(0, 0, 0, 0);

    if (Number.isNaN(interventionDate.getTime())) return 'Planifié';
    if (interventionDate < today) return 'Terminé';
    return 'Planifié';
}

function createDefaultClients() {
    return [
        { id: 1, company: 'Frater razes', contact: 'Khaled', phone: '01 55 01 02 00', email: 'khaled@fraterrazes.com', address: 'Alger, rouiba' },
        { id: 2, company: 'Ramy', contact: 'Yacine', phone: '01 55 01 99 00', email: 'yacine@ramy.com', address: '456 Rue Affaires' },
        { id: 3, company: 'Seal', contact: 'Karim', phone: '01 55 02 34 00', email: 'karim@seal.com', address: '789 Allée Ciel' },
    ];
}

function createDefaultContracts() {
    return [
        {
            id: 1,
            name: 'Maintenance Annuelle A',
            client: 'Frater razes',
            start: '2026-01-10',
            end: '2026-12-10',
            total: 6,
            status: 'Actif',
            planningMode: 'auto',
            chaudiereDates: generateAutomaticDates('2026-01-10', '2026-12-10', 4),
            bruleurDates: generateAutomaticDates('2026-01-10', '2026-12-10', 2),
            notes: 'Maintenance préventive annuelle.',
        },
        {
            id: 2,
            name: 'Support Urgence B',
            client: 'Ramy',
            start: '2026-03-01',
            end: '2026-12-01',
            total: 8,
            status: 'Actif',
            planningMode: 'auto',
            chaudiereDates: generateAutomaticDates('2026-03-01', '2026-12-01', 3),
            bruleurDates: generateAutomaticDates('2026-03-01', '2026-12-01', 5),
            notes: 'Passages planifiés et astreinte.',
        },
        {
            id: 3,
            name: 'Inspection Canalisations',
            client: 'Seal',
            start: '2026-04-15',
            end: '2026-07-15',
            total: 4,
            status: 'En attente',
            planningMode: 'manual',
            chaudiereDates: ['2026-04-15', '2026-06-15'],
            bruleurDates: ['2026-05-15', '2026-07-15'],
            notes: 'Dates imposées par le syndic.',
        },
    ];
}

function createDefaultInterventions(contracts) {
    const items = [];
    let sequence = 1;

    contracts.forEach(contract => {
        [
            { type: INTERVENTION_TYPES.CHAUDIERE, dates: contract.chaudiereDates || [] },
            { type: INTERVENTION_TYPES.BRULEUR, dates: contract.bruleurDates || [] },
        ].forEach(({ type, dates }) => {
            dates.forEach((date, index) => {
                items.push({
                    id: formatInterventionId(sequence),
                    client: contract.client,
                    contractId: contract.id,
                    type,
                    date,
                    priority: ['Moyenne', 'Élevée', 'Faible'][index % 3],
                    status: defaultInterventionStatus(date),
                    notes: '',
                    source: 'contract',
                });
                sequence += 1;
            });
        });
    });

    return items;
}

function createDefaultState() {
    const contracts = createDefaultContracts();

    return {
        clients: createDefaultClients(),
        contracts,
        interventions: createDefaultInterventions(contracts),
    };
}

createApp({

    data() {
        return {
            isAuthenticated: false,
            currentPage: 'dashboard',
            sidebarOpen: false,
            activeModal: null,
            toastMessage: '',
            toastVisible: false,
            notificationsOpen: false,
            interventionView: 'list',
            interventionFilterType: '',
            interventionFilterStart: defaultInterventionFilterRange().start,
            interventionFilterEnd: defaultInterventionFilterRange().end,
            interventionPage: 1,
            interventionPageSize: 10,
            clientSearch: '',
            contractSearch: '',
            chartRefreshQueued: false,
            chartInstances: {},
            apiBase: API_BASE,
            stateLoaded: false,
            stateApplying: false,
            stateSaveQueued: false,

            loginForm: { username: '', password: '' },
            loginError: '',

            notifications: [],
            notifSettings: { daysBeforeIntervention: 3 },
            notifDaysDraft: '3',
            notifReadStatus: {},
            clients: [],
            contracts: [],
            interventions: [],

            editingClientId: null,
            editingContractId: null,
            editingInterventionId: null,
            selectedContractId: null,

            clientForm: { company: '', contact: '', phone: '', email: '', address: '' },
            contractForm: {
                name: '',
                client: '',
                start: '',
                end: '',
                status: 'Actif',
                notes: '',
                chaudierePlanningMode: 'auto',
                chaudiereTotal: 1,
                chaudiereManualDatesText: '',
                bruleurPlanningMode: 'auto',
                bruleurTotal: 1,
                bruleurManualDatesText: '',
            },
            interventionForm: {
                client: '',
                contractId: '',
                type: INTERVENTION_TYPES.CHAUDIERE,
                date: '',
                priority: 'Moyenne',
                status: 'Planifié',
                notes: '',
            },
        };
    },

    computed: {
        pageTitle() {
            const titles = {
                dashboard: 'Tableau de bord',
                clients: 'Clients',
                contracts: 'Contrats',
                interventions: 'Interventions',
                reports: 'Rapports & KPIs',
                parametres: 'Paramètres',
            };
            return titles[this.currentPage] || '';
        },

        filteredClients() {
            const q = this.clientSearch.toLowerCase();
            return this.clients.filter(client =>
                client.company.toLowerCase().includes(q) || client.contact.toLowerCase().includes(q)
            );
        },

        filteredContracts() {
            const q = this.contractSearch.toLowerCase();
            return this.contracts.filter(contract =>
                contract.name.toLowerCase().includes(q) || contract.client.toLowerCase().includes(q)
            );
        },

        filteredInterventions() {
            let items = [...this.interventions];

            if (this.interventionFilterType) {
                items = items.filter(intervention =>
                    (intervention.type || INTERVENTION_TYPES.CHAUDIERE) === this.interventionFilterType
                );
            }

            if (this.interventionFilterStart) {
                items = items.filter(intervention => intervention.date >= this.interventionFilterStart);
            }

            if (this.interventionFilterEnd) {
                items = items.filter(intervention => intervention.date <= this.interventionFilterEnd);
            }

            return items.sort((left, right) => new Date(left.date) - new Date(right.date));
        },

        interventionTotalPages() {
            return Math.max(1, Math.ceil(this.filteredInterventions.length / this.interventionPageSize));
        },

        paginatedInterventions() {
            const page = Math.min(Math.max(1, this.interventionPage), this.interventionTotalPages);
            const offset = (page - 1) * this.interventionPageSize;
            return this.filteredInterventions.slice(offset, offset + this.interventionPageSize);
        },

        interventionPaginationFrom() {
            if (!this.filteredInterventions.length) return 0;
            return (Math.min(this.interventionPage, this.interventionTotalPages) - 1) * this.interventionPageSize + 1;
        },

        interventionPaginationTo() {
            if (!this.filteredInterventions.length) return 0;
            return Math.min(
                this.interventionPaginationFrom + this.interventionPageSize - 1,
                this.filteredInterventions.length
            );
        },

        interventionTypeEditable() {
            if (!this.editingInterventionId) return true;
            const existing = this.interventions.find(item => item.id === this.editingInterventionId);
            return !existing?.contractId || existing?.source !== 'contract';
        },

        unreadNotificationsCount() {
            return this.notifications.filter(notification => !notification.read).length;
        },

        dashboardStats() {
            return [
                { label: 'Total Clients', icon: 'fas fa-users', color: 'blue', value: this.clients.length },
                { label: 'Contrats Actifs', icon: 'fas fa-file-signature', color: 'green', value: this.activeContractsCount },
                { label: 'Interventions Ouvertes', icon: 'fas fa-tools', color: 'orange', value: this.openInterventionsCount },
                { label: 'Terminées (Mois)', icon: 'fas fa-check-double', color: 'purple', value: this.completedThisMonthCount },
            ];
        },

        activeContractsCount() {
            return this.contracts.filter(contract => contract.status === 'Actif').length;
        },

        openInterventionsCount() {
            return this.interventions.filter(intervention => !['Terminé', 'Annulé'].includes(intervention.status)).length;
        },

        completedThisMonthCount() {
            const now = new Date();
            return this.interventions.filter(intervention => {
                if (intervention.status !== 'Terminé') return false;
                const interventionDate = new Date(intervention.date);
                return interventionDate.getMonth() === now.getMonth() && interventionDate.getFullYear() === now.getFullYear();
            }).length;
        },

        completionRate() {
            if (!this.interventions.length) return 0;
            const completed = this.interventions.filter(intervention => intervention.status === 'Terminé').length;
            return Math.round((completed / this.interventions.length) * 1000) / 10;
        },

        selectedContract() {
            return this.contracts.find(contract => contract.id === this.selectedContractId) || null;
        },

        topClientsByVolume() {
            return this.clients
                .map(client => ({
                    company: client.company,
                    volume: this.interventions.filter(intervention => intervention.client === client.company).length,
                }))
                .sort((left, right) => right.volume - left.volume)
                .slice(0, 5);
        },
    },

    watch: {
        currentPage(page) {
            if (!this.isAuthenticated) return;
            this.queueChartRefresh(page);
        },

        isAuthenticated(value) {
            localStorage.setItem(AUTH_KEY, JSON.stringify(value));
            if (value) this.queueChartRefresh();
        },

        clients: {
            deep: true,
            handler() {
            },
        },

        contracts: {
            deep: true,
            handler() {
                if (this.stateApplying) return;
                if (this.isAuthenticated) this.queueChartRefresh();
            },
        },

        interventions: {
            deep: true,
            handler() {
                if (this.stateApplying) return;
                this.syncInterventionNotifications();
                if (this.isAuthenticated) this.queueChartRefresh();
            },
        },

        interventionFilterType() {
            this.interventionPage = 1;
        },

        interventionFilterStart() {
            this.interventionPage = 1;
        },

        interventionFilterEnd() {
            this.interventionPage = 1;
        },

        interventionTotalPages(total) {
            if (this.interventionPage > total) this.interventionPage = total;
        },

    },

    async mounted() {
        await this.loadState();
        this.isAuthenticated = JSON.parse(localStorage.getItem(AUTH_KEY) || 'false');
    },

    beforeUnmount() {
        Object.keys(this.chartInstances).forEach(id => this.destroyChart(id));
    },

    methods: {
        async apiRequest(path, options = {}) {
            const response = await fetch(`${this.apiBase}${path}`, {
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                ...options,
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || 'Erreur API.');
            }

            return response.json();
        },

        async loadState() {
            const defaults = createDefaultState();
            let stored = null;

            this.stateApplying = true;

            try {
                stored = await this.apiRequest('/state');
            } catch (error) {
                console.error('Unable to load API state.', error);
                stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            }

            this.notifSettings = {
                daysBeforeIntervention: Math.max(1, Number(stored?.notifSettings?.daysBeforeIntervention) || 3),
            };
            this.notifDaysDraft = String(this.notifSettings.daysBeforeIntervention);
            this.notifReadStatus = stored?.notifReadStatus || {};
            this.clients = Array.isArray(stored?.clients) ? stored.clients.map(client => this.normalizeClient(client)) : defaults.clients;
            this.contracts = (Array.isArray(stored?.contracts) ? stored.contracts : defaults.contracts)
                .map(contract => this.normalizeContract(contract))
                .map(contract => this.migrateContractToCurrentYear(contract));
            this.interventions = (Array.isArray(stored?.interventions) ? stored.interventions : defaults.interventions)
                .map(intervention => this.normalizeIntervention(intervention))
                .map(intervention => this.migrateInterventionToCurrentYear(intervention));
            this.migrateInterventionTypes();
            this.renumberInterventionIds();
            this.syncInterventionNotifications();
            this.stateLoaded = true;

            this.$nextTick(() => {
                this.stateApplying = false;
            });
        },

        persistState() {
            if (!this.stateLoaded) return;

            const state = {
                clients: this.clients,
                contracts: this.contracts,
                interventions: this.interventions,
                notifSettings: this.notifSettings,
                notifReadStatus: this.notifReadStatus,
            };

            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

            if (this.stateSaveQueued) return;
            this.stateSaveQueued = true;
            setTimeout(async () => {
                this.stateSaveQueued = false;
                try {
                    const saved = await this.apiRequest('/state', {
                        method: 'PUT',
                        body: JSON.stringify(state),
                    });
                    this.stateApplying = true;
                    this.clients = saved.clients.map(client => this.normalizeClient(client));
                    this.contracts = saved.contracts.map(contract => this.normalizeContract(contract));
                    this.interventions = saved.interventions.map(intervention => this.normalizeIntervention(intervention));
                    this.notifSettings = {
                        daysBeforeIntervention: Math.max(1, Number(saved?.notifSettings?.daysBeforeIntervention) || 3),
                    };
                    if (this.currentPage !== 'parametres') {
                        this.notifDaysDraft = String(this.notifSettings.daysBeforeIntervention);
                    }
                    this.notifReadStatus = saved?.notifReadStatus || {};
                    this.syncInterventionNotifications();
                    this.$nextTick(() => {
                        this.stateApplying = false;
                    });
                } catch (error) {
                    this.stateApplying = false;
                    console.error('Unable to save API state.', error);
                    this.showToast('Sauvegarde serveur impossible.');
                }
            }, 100);
        },

        normalizeClient(client) {
            return {
                id: client.id,
                company: client.company || '',
                contact: client.contact || '',
                phone: client.phone || '',
                email: client.email || '',
                address: client.address || '',
            };
        },

        normalizeContract(contract) {
            const schedules = parseContractSchedules(
                contract.chaudiereDates || contract.bruleurDates
                    ? { chaudiereDates: contract.chaudiereDates, bruleurDates: contract.bruleurDates }
                    : contract.interventionDates
            );

            let chaudiereDates = schedules.chaudiereDates;
            let bruleurDates = schedules.bruleurDates;

            if (!chaudiereDates.length && !bruleurDates.length) {
                chaudiereDates = generateAutomaticDates(contract.start, contract.end, contract.total || 1);
            }

            const allDates = contractAllDates({ chaudiereDates, bruleurDates });

            return {
                id: contract.id,
                name: contract.name || '',
                client: contract.client || '',
                start: contract.start || allDates[0] || '',
                end: contract.end || allDates[allDates.length - 1] || '',
                total: contractTotalInterventions({ chaudiereDates, bruleurDates }),
                status: contract.status || 'Actif',
                planningMode: contract.planningMode || 'auto',
                chaudierePlanningMode: contract.chaudierePlanningMode || contract.planningMode || 'auto',
                bruleurPlanningMode: contract.bruleurPlanningMode || contract.planningMode || 'auto',
                chaudiereDates,
                bruleurDates,
                notes: contract.notes || '',
            };
        },

        migrateContractToCurrentYear(contract) {
            const chaudiereDates = moveDatesToYear(contract.chaudiereDates);
            const bruleurDates = moveDatesToYear(contract.bruleurDates);
            const allDates = contractAllDates({ chaudiereDates, bruleurDates });
            const start = moveDateToYear(contract.start || allDates[0]) || allDates[0] || '';
            const end = moveDateToYear(contract.end || allDates[allDates.length - 1]) || allDates[allDates.length - 1] || '';

            return {
                ...contract,
                start,
                end,
                total: contractTotalInterventions({ chaudiereDates, bruleurDates }),
                chaudiereDates,
                bruleurDates,
            };
        },

        normalizeIntervention(intervention) {
            const sequence = parseInterventionSequence(intervention.id);
            const id = sequence > 0 ? formatInterventionId(sequence) : intervention.id;

            return {
                id,
                client: intervention.client || '',
                contractId: intervention.contractId ?? null,
                type: intervention.type || null,
                date: intervention.date || '',
                priority: intervention.priority || 'Moyenne',
                status: intervention.status || 'Planifié',
                notes: intervention.notes || '',
                source: intervention.source || null,
            };
        },

        migrateInterventionTypes() {
            this.interventions = this.interventions.map(intervention => {
                if (intervention.type || !intervention.contractId) return intervention;

                const contract = this.contracts.find(item => item.id === intervention.contractId);
                if (!contract) return intervention;

                if ((contract.bruleurDates || []).includes(intervention.date)) {
                    return { ...intervention, type: INTERVENTION_TYPES.BRULEUR };
                }

                return { ...intervention, type: INTERVENTION_TYPES.CHAUDIERE };
            });
        },

        renumberInterventionIds() {
            const sorted = [...this.interventions].sort((left, right) => {
                const leftSeq = parseInterventionSequence(left.id);
                const rightSeq = parseInterventionSequence(right.id);
                if (leftSeq && rightSeq && leftSeq !== rightSeq) return leftSeq - rightSeq;
                return new Date(left.date) - new Date(right.date);
            });

            const idMap = new Map();
            sorted.forEach((intervention, index) => {
                const nextId = formatInterventionId(index + 1);
                if (intervention.id !== nextId) idMap.set(intervention.id, nextId);
            });

            if (!idMap.size) return;

            this.interventions = this.interventions.map(intervention => (
                idMap.has(intervention.id) ? { ...intervention, id: idMap.get(intervention.id) } : intervention
            ));

            this.notifReadStatus = Object.fromEntries(
                Object.entries(this.notifReadStatus).map(([id, read]) => [idMap.get(id) || id, read])
            );
        },

        migrateInterventionToCurrentYear(intervention) {
            const date = moveDateToYear(intervention.date) || intervention.date;
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const interventionDate = new Date(date);
            interventionDate.setHours(0, 0, 0, 0);

            let status = intervention.status;
            if (
                status === 'Terminé'
                && !Number.isNaN(interventionDate.getTime())
                && interventionDate >= today
            ) {
                status = 'Planifié';
            }

            return {
                ...intervention,
                date,
                status,
            };
        },

        async login() {
            try {
                await this.apiRequest('/login', {
                    method: 'POST',
                    body: JSON.stringify(this.loginForm),
                });
                await this.loadState();
                this.isAuthenticated = true;
                this.loginError = '';
                this.loginForm = { username: '', password: '' };
                this.showToast('Connexion réussie.');
                return;
            } catch (error) {
                console.error('Unable to log in.', error);
                if (error instanceof TypeError) {
                    this.loginError = 'Serveur API indisponible. D\u00e9marrez FastAPI puis r\u00e9essayez.';
                    return;
                }
            }

            this.loginError = 'Identifiant ou mot de passe incorrect.';
        },

        logout() {
            this.isAuthenticated = false;
            this.sidebarOpen = false;
            this.notificationsOpen = false;
            this.activeModal = null;
            this.currentPage = 'dashboard';
            this.loginError = '';
        },

        navigate(page) {
            this.currentPage = page;
            this.notificationsOpen = false;
            if (window.innerWidth <= 768) this.sidebarOpen = false;
            if (page === 'parametres') {
                this.notifDaysDraft = String(this.notifSettings.daysBeforeIntervention);
            }
            if (page === 'interventions') {
                this.interventionPage = 1;
            }
        },

        setInterventionPage(page) {
            const next = Math.min(Math.max(1, page), this.interventionTotalPages);
            this.interventionPage = next;
        },

        saveNotifSettings() {
            const raw = String(this.notifDaysDraft).trim();
            const parsed = Number(raw);
            if (raw === '' || !Number.isFinite(parsed)) {
                this.showToast('Veuillez entrer un nombre de jours valide.');
                return;
            }
            const days = Math.min(60, Math.max(1, Math.round(parsed)));
            this.notifSettings.daysBeforeIntervention = days;
            this.notifDaysDraft = String(days);
            this.persistState();
            this.syncInterventionNotifications();
            this.showToast('Paramètres enregistrés.');
        },

        openModal(name) {
            this.activeModal = name;
        },

        closeModal() {
            this.activeModal = null;
            this.selectedContractId = null;
        },

        toggleNotifications() {
            this.notificationsOpen = !this.notificationsOpen;
        },

        syncInterventionNotifications() {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const limit = Number(this.notifSettings.daysBeforeIntervention) || 3;

            const upcoming = this.interventions.filter(i => {
                if (['Terminé', 'Annulé'].includes(i.status)) return false;
                const iDate = new Date(i.date);
                if (isNaN(iDate)) return false;
                iDate.setHours(0, 0, 0, 0);
                const diff = Math.round((iDate - today) / 86400000);
                return diff >= 0 && diff <= limit;
            }).sort((left, right) => new Date(left.date) - new Date(right.date));

            const activeNotificationIds = new Set(upcoming.map(intervention => intervention.id));
            this.notifReadStatus = Object.fromEntries(
                Object.entries(this.notifReadStatus).filter(([id]) => activeNotificationIds.has(id))
            );

            this.notifications = upcoming.map(i => {
                const iDate = new Date(i.date);
                iDate.setHours(0, 0, 0, 0);
                const diff = Math.round((iDate - today) / 86400000);
                const daysText = diff === 0 ? "aujourd'hui" : diff === 1 ? 'demain' : `dans ${diff} jour(s)`;
                return {
                    id: `notif-${i.id}`,
                    interventionId: i.id,
                    title: 'Intervention à venir',
                    message: `Intervention chez ${i.client} prévue le ${i.date} (${daysText}).`,
                    time: daysText,
                    read: this.notifReadStatus[i.id] || false,
                };
            });
        },

        markNotificationRead(id) {
            const notification = this.notifications.find(item => item.id === id);
            if (!notification || notification.read) return;
            this.notifReadStatus[notification.interventionId] = true;
            notification.read = true;
            this.persistState();
        },

        markAllNotificationsRead() {
            this.notifications.forEach(notification => {
                this.notifReadStatus[notification.interventionId] = true;
                notification.read = true;
            });
            this.persistState();
        },

        openClientModal() {
            this.editingClientId = null;
            this.clientForm = { company: '', contact: '', phone: '', email: '', address: '' };
            this.openModal('clientModal');
        },

        startEditClient(client) {
            this.editingClientId = client.id;
            this.clientForm = { ...client };
            this.openModal('clientModal');
        },

        submitClient() {
            const payload = this.normalizeClient({ id: this.editingClientId || Date.now(), ...this.clientForm });

            if (this.editingClientId) {
                const existing = this.clients.find(client => client.id === this.editingClientId);
                const previousCompany = existing?.company || payload.company;
                this.clients = this.clients.map(client => client.id === this.editingClientId ? payload : client);
                this.renameClientReferences(previousCompany, payload.company);
                this.showToast('Client mis à jour avec succès !');
            } else {
                this.clients.push(payload);
                this.showToast('Client ajouté avec succès !');
            }

            this.persistState();
            this.closeModal();
        },

        renameClientReferences(previousCompany, nextCompany) {
            if (!previousCompany || previousCompany === nextCompany) return;

            this.contracts = this.contracts.map(contract => contract.client === previousCompany ? { ...contract, client: nextCompany } : contract);
            this.interventions = this.interventions.map(intervention => intervention.client === previousCompany ? { ...intervention, client: nextCompany } : intervention);
        },

        deleteClient(id) {
            if (!confirm('Confirmer la suppression de ce client ?')) return;

            const client = this.clients.find(item => item.id === id);
            if (!client) return;

            this.clients = this.clients.filter(item => item.id !== id);
            this.contracts = this.contracts.filter(contract => contract.client !== client.company);
            this.interventions = this.interventions.filter(intervention => intervention.client !== client.company);
            this.persistState();
            this.showToast('Client supprimé.');
        },

        resolveContractScheduleDates(planningMode, start, end, total, manualDatesText) {
            return planningMode === 'manual'
                ? parseManualDates(manualDatesText)
                : generateAutomaticDates(start, end, total);
        },

        openContractModal() {
            this.editingContractId = null;
            this.contractForm = {
                name: '',
                client: '',
                start: '',
                end: '',
                status: 'Actif',
                notes: '',
                chaudierePlanningMode: 'auto',
                chaudiereTotal: 1,
                chaudiereManualDatesText: '',
                bruleurPlanningMode: 'auto',
                bruleurTotal: 1,
                bruleurManualDatesText: '',
            };
            this.openModal('contractModal');
        },

        startEditContract(contract) {
            this.editingContractId = contract.id;
            this.contractForm = {
                name: contract.name,
                client: contract.client,
                start: contract.start,
                end: contract.end,
                status: contract.status,
                notes: contract.notes || '',
                chaudierePlanningMode: contract.chaudierePlanningMode || contract.planningMode || 'auto',
                chaudiereTotal: Math.max(1, contract.chaudiereDates?.length || 1),
                chaudiereManualDatesText: (contract.chaudiereDates || []).join('\n'),
                bruleurPlanningMode: contract.bruleurPlanningMode || contract.planningMode || 'auto',
                bruleurTotal: Math.max(1, contract.bruleurDates?.length || 1),
                bruleurManualDatesText: (contract.bruleurDates || []).join('\n'),
            };
            this.openModal('contractModal');
        },

        openContractDetails(contract) {
            this.selectedContractId = contract.id;
            this.openModal('contractDetailModal');
        },

        submitContract() {
            const chaudiereDates = this.resolveContractScheduleDates(
                this.contractForm.chaudierePlanningMode,
                this.contractForm.start,
                this.contractForm.end,
                this.contractForm.chaudiereTotal,
                this.contractForm.chaudiereManualDatesText
            );
            const bruleurDates = this.resolveContractScheduleDates(
                this.contractForm.bruleurPlanningMode,
                this.contractForm.start,
                this.contractForm.end,
                this.contractForm.bruleurTotal,
                this.contractForm.bruleurManualDatesText
            );

            if (!chaudiereDates.length && !bruleurDates.length) {
                this.showToast('Planifiez au moins une intervention (chaudière ou brûleur).');
                return;
            }

            const allDates = contractAllDates({ chaudiereDates, bruleurDates });
            const usesAuto = this.contractForm.chaudierePlanningMode === 'auto' || this.contractForm.bruleurPlanningMode === 'auto';
            const contractId = this.editingContractId || Date.now();
            const contract = this.normalizeContract({
                id: contractId,
                name: this.contractForm.name,
                client: this.contractForm.client,
                start: usesAuto ? this.contractForm.start : allDates[0],
                end: usesAuto ? this.contractForm.end : allDates[allDates.length - 1],
                total: allDates.length,
                status: this.contractForm.status,
                planningMode: this.contractForm.chaudierePlanningMode === 'manual' || this.contractForm.bruleurPlanningMode === 'manual'
                    ? 'manual'
                    : 'auto',
                chaudierePlanningMode: this.contractForm.chaudierePlanningMode,
                bruleurPlanningMode: this.contractForm.bruleurPlanningMode,
                chaudiereDates,
                bruleurDates,
                notes: this.contractForm.notes,
            });

            const exists = this.contracts.some(item => item.id === contractId);
            if (exists) {
                this.contracts = this.contracts.map(item => item.id === contractId ? contract : item);
                this.showToast('Contrat mis à jour avec succès !');
            } else {
                this.contracts.push(contract);
                this.showToast('Contrat créé avec succès !');
            }

            this.syncContractInterventions(contract);
            this.persistState();
            this.closeModal();
        },

        deleteContract(id) {
            if (!confirm('Supprimer ce contrat et les interventions liées ?')) return;

            this.contracts = this.contracts.filter(contract => contract.id !== id);
            this.interventions = this.interventions.filter(intervention => intervention.contractId !== id);

            if (this.selectedContractId === id) this.closeModal();

            this.persistState();
            this.showToast('Contrat supprimé.');
        },

        syncContractInterventions(contract) {
            const existing = this.interventions.filter(intervention => intervention.contractId === contract.id);
            const existingByKey = new Map(
                existing.map(intervention => [`${intervention.type || INTERVENTION_TYPES.CHAUDIERE}:${intervention.date}`, intervention])
            );
            const schedules = [
                { type: INTERVENTION_TYPES.CHAUDIERE, dates: contract.chaudiereDates || [] },
                { type: INTERVENTION_TYPES.BRULEUR, dates: contract.bruleurDates || [] },
            ];
            const synced = [];

            schedules.forEach(({ type, dates }) => {
                dates.forEach(date => {
                    const key = `${type}:${date}`;
                    const current = existingByKey.get(key);

                    if (current) {
                        synced.push({
                            ...current,
                            client: contract.client,
                            type,
                        });
                        return;
                    }

                    synced.push({
                        id: allocateInterventionId([...this.interventions, ...synced]),
                        client: contract.client,
                        contractId: contract.id,
                        type,
                        date,
                        priority: 'Moyenne',
                        status: defaultInterventionStatus(date),
                        notes: '',
                        source: 'contract',
                    });
                });
            });

            this.interventions = [
                ...this.interventions.filter(intervention => intervention.contractId !== contract.id),
                ...synced,
            ].sort((left, right) => new Date(left.date) - new Date(right.date));
        },

        resetInterventionForm() {
            this.interventionForm = {
                client: '',
                contractId: '',
                type: INTERVENTION_TYPES.CHAUDIERE,
                date: '',
                priority: 'Moyenne',
                status: 'Planifié',
                notes: '',
            };
        },

        openInterventionModal() {
            this.editingInterventionId = null;
            this.resetInterventionForm();
            this.openModal('interventionModal');
        },

        startEditIntervention(intervention) {
            this.editingInterventionId = intervention.id;
            this.interventionForm = {
                client: intervention.client,
                contractId: intervention.contractId ?? '',
                type: intervention.type || INTERVENTION_TYPES.CHAUDIERE,
                date: intervention.date,
                priority: intervention.priority,
                status: intervention.status,
                notes: intervention.notes || '',
            };
            this.openModal('interventionModal');
        },

        syncInterventionClientWithContract() {
            if (!this.interventionForm.contractId) return;

            const contract = this.contracts.find(item => item.id === Number(this.interventionForm.contractId));
            if (contract) this.interventionForm.client = contract.client;
        },

        updateContractInterventionDate(intervention, nextDate) {
            if (!intervention?.contractId) return true;
            if (!nextDate) {
                this.showToast('Sélectionnez une date d\'intervention valide.');
                return false;
            }

            const contract = this.contracts.find(item => item.id === intervention.contractId);
            if (!contract) return true;

            const scheduleType = intervention.type === INTERVENTION_TYPES.BRULEUR
                ? INTERVENTION_TYPES.BRULEUR
                : INTERVENTION_TYPES.CHAUDIERE;
            const scheduleKey = scheduleType === INTERVENTION_TYPES.BRULEUR ? 'bruleurDates' : 'chaudiereDates';
            const currentDates = [...(contract[scheduleKey] || [])];
            const nextDates = currentDates.map(date => (date === intervention.date ? nextDate : date));
            const uniqueDates = uniqueSortedDates(nextDates);

            if (uniqueDates.length !== nextDates.length) {
                this.showToast('Cette date existe déjà pour ce type d\'intervention.');
                return false;
            }

            const updatedContract = this.normalizeContract({
                ...contract,
                planningMode: 'manual',
                [scheduleKey]: uniqueDates,
            });

            this.contracts = this.contracts.map(item => item.id === contract.id ? updatedContract : item);
            return true;
        },

        submitIntervention() {
            const existing = this.editingInterventionId
                ? this.interventions.find(item => item.id === this.editingInterventionId)
                : null;
            const linkedContract = this.interventionForm.contractId
                ? this.contracts.find(item => item.id === Number(this.interventionForm.contractId))
                : null;

            if (existing?.contractId && !this.updateContractInterventionDate(existing, this.interventionForm.date)) {
                return;
            }

            const resolvedType = this.interventionTypeEditable
                ? (this.interventionForm.type || INTERVENTION_TYPES.CHAUDIERE)
                : (existing?.type || INTERVENTION_TYPES.CHAUDIERE);

            if (!existing?.contractId && !resolvedType) {
                this.showToast('Sélectionnez un type d\'intervention (Chaudière ou Brûleur).');
                return;
            }

            const payload = this.normalizeIntervention({
                id: this.editingInterventionId || allocateInterventionId(this.interventions),
                client: linkedContract?.client || this.interventionForm.client,
                contractId: this.interventionForm.contractId ? Number(this.interventionForm.contractId) : null,
                type: resolvedType,
                date: this.interventionForm.date,
                priority: this.interventionForm.priority,
                status: this.interventionForm.status,
                notes: this.interventionForm.notes,
                source: existing?.source || 'manual',
            });

            if (this.editingInterventionId) {
                this.interventions = this.interventions.map(intervention =>
                    intervention.id === this.editingInterventionId ? payload : intervention
                );
                this.showToast('Intervention mise à jour avec succès !');
            } else {
                this.interventions.push(payload);
                this.showToast('Intervention planifiée avec succès !');
            }

            this.persistState();
            this.closeModal();
        },

        deleteIntervention(id) {
            if (!confirm('Confirmer la suppression ?')) return;

            this.interventions = this.interventions.filter(intervention => intervention.id !== id);
            this.persistState();
            this.showToast('Intervention supprimée.');
        },

        updateInterventionStatus(id, status) {
            const intervention = this.interventions.find(item => item.id === id);
            if (!intervention) return;
            intervention.status = status;
            this.persistState();
        },

        clientContractCount(company) {
            return this.contracts.filter(contract => contract.client === company).length;
        },

        contractCompletedCount(contract) {
            return this.interventions.filter(intervention => intervention.contractId === contract.id && intervention.status === 'Terminé').length;
        },

        contractInterventionTotal(contract) {
            return contractTotalInterventions(contract);
        },

        contractCompletionPercent(contract) {
            const total = this.contractInterventionTotal(contract);
            if (!total) return 0;
            return Math.round((this.contractCompletedCount(contract) / total) * 100);
        },

        contractInterventions(contractId) {
            return this.interventions
                .filter(intervention => intervention.contractId === contractId)
                .sort((left, right) => new Date(left.date) - new Date(right.date));
        },

        contractInterventionsByType(contractId, type) {
            return this.contractInterventions(contractId)
                .filter(intervention => (intervention.type || INTERVENTION_TYPES.CHAUDIERE) === type);
        },

        interventionTypeLabel(type) {
            return interventionTypeLabel(type);
        },

        interventionsByMonth() {
            const labels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
            const totals = Array(12).fill(0);

            this.interventions.forEach(intervention => {
                const month = new Date(intervention.date).getMonth();
                if (!Number.isNaN(month)) totals[month] += 1;
            });

            return { labels, totals };
        },

        contractStatusDistribution() {
            return [
                this.contracts.filter(contract => contract.status === 'Actif').length,
                this.contracts.filter(contract => contract.status === 'En attente').length,
                this.contracts.filter(contract => contract.status === 'Terminé').length,
            ];
        },

        statusClass(status) {
            if (['Actif', 'Terminé'].includes(status)) return 'badge-active';
            if (['Expiré', 'Annulé'].includes(status)) return 'badge-danger';
            return 'badge-pending';
        },

        priorityColor(priority) {
            if (priority === 'Élevée') return 'var(--danger)';
            if (priority === 'Moyenne') return 'var(--warning)';
            return 'inherit';
        },

        showToast(msg) {
            this.toastMessage = msg;
            this.toastVisible = true;
            setTimeout(() => { this.toastVisible = false; }, 3000);
        },

        refreshChartsIfVisible() {
            if (this.currentPage === 'dashboard') this.initDashboardCharts();
            if (this.currentPage === 'reports') this.initReportCharts();
        },

        queueChartRefresh(targetPage = this.currentPage) {
            if (this.chartRefreshQueued) return;

            this.chartRefreshQueued = true;
            this.$nextTick(() => {
                this.chartRefreshQueued = false;
                if (!this.isAuthenticated) return;
                if (targetPage === 'dashboard') this.initDashboardCharts();
                if (targetPage === 'reports') this.initReportCharts();
            });
        },

        destroyChart(id) {
            const chart = this.chartInstances[id];
            if (!chart) return;

            try {
                chart.destroy();
            } catch (error) {
                console.warn(`Unable to destroy chart ${id}.`, error);
            }

            delete this.chartInstances[id];
        },

        initChart(id, config) {
            const canvas = document.getElementById(id);
            if (!canvas) {
                this.destroyChart(id);
                return;
            }

            this.destroyChart(id);

            const context = canvas.getContext('2d');
            if (!context) return;
            this.chartInstances[id] = new Chart(context, config);
        },

        initDashboardCharts() {
            const monthlyInterventions = this.interventionsByMonth();

            this.initChart('interventionsChart', {
                type: 'bar',
                data: {
                    labels: monthlyInterventions.labels,
                    datasets: [{
                        label: 'Interventions',
                        data: monthlyInterventions.totals,
                        backgroundColor: '#2563EB',
                        borderRadius: 6,
                    }],
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                },
            });

            this.initChart('statusChart', {
                type: 'doughnut',
                data: {
                    labels: ['Actifs', 'En attente', 'Terminés'],
                    datasets: [{
                        data: this.contractStatusDistribution(),
                        backgroundColor: ['#16A34A', '#F59E0B', '#DC2626'],
                    }],
                },
                options: { cutout: '70%' },
            });
        },

        initReportCharts() {
        },

        interventionStatusOptions() {
            return INTERVENTION_STATUSES;
        },

        interventionTypeOptions() {
            return [
                { value: INTERVENTION_TYPES.CHAUDIERE, label: 'Chaudière' },
                { value: INTERVENTION_TYPES.BRULEUR, label: 'Brûleur' },
            ];
        },
    },

}).mount('#app');
