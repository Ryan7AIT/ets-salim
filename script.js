/**
 * PlombTrack — Application Vue 3 (Options API)
 */
const { createApp } = Vue;

const STORAGE_KEY = 'plombtrack-storage-v2';
const AUTH_KEY = 'plombtrack-auth-v1';
const INTERVENTION_STATUSES = ['Planifié', 'En cours', 'Terminé', 'Annulé'];
const CURRENT_DATA_YEAR = 2026;

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
        { id: 1, company: 'Grand Hôtel Residencia', contact: 'Sarah Jenkins', phone: '01 55 01 02 00', email: 's.jenkins@grandhotel.com', address: '123 Bd Océan' },
        { id: 2, company: 'City Property Mgmt', contact: 'Marc Thompson', phone: '01 55 01 99 00', email: 'marc@cityprop.com', address: '456 Rue Affaires' },
        { id: 3, company: 'Blue Sky Appartements', contact: 'Elena Rodriguez', phone: '01 55 02 34 00', email: 'elena@bluesky.com', address: '789 Allée Ciel' },
    ];
}

function createDefaultContracts() {
    return [
        {
            id: 1,
            name: 'Maintenance Annuelle A',
            client: 'Grand Hôtel Residencia',
            start: '2026-01-10',
            end: '2026-12-10',
            total: 6,
            status: 'Actif',
            planningMode: 'auto',
            interventionDates: generateAutomaticDates('2026-01-10', '2026-12-10', 6),
            notes: 'Maintenance préventive annuelle.',
        },
        {
            id: 2,
            name: 'Support Urgence B',
            client: 'City Property Mgmt',
            start: '2026-03-01',
            end: '2026-12-01',
            total: 8,
            status: 'Actif',
            planningMode: 'auto',
            interventionDates: generateAutomaticDates('2026-03-01', '2026-12-01', 8),
            notes: 'Passages planifiés et astreinte.',
        },
        {
            id: 3,
            name: 'Inspection Canalisations',
            client: 'Blue Sky Appartements',
            start: '2026-04-15',
            end: '2026-07-15',
            total: 4,
            status: 'En attente',
            planningMode: 'manual',
            interventionDates: ['2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15'],
            notes: 'Dates imposées par le syndic.',
        },
    ];
}

function createDefaultInterventions(contracts) {
    const items = contracts.flatMap(contract =>
        contract.interventionDates.map((date, index) => ({
            id: `INT-${contract.id}${String(index + 1).padStart(2, '0')}`,
            client: contract.client,
            contractId: contract.id,
            date,
            priority: ['Moyenne', 'Élevée', 'Faible'][index % 3],
            status: defaultInterventionStatus(date),
            notes: '',
            source: 'contract',
        }))
    );

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
            clientSearch: '',
            contractSearch: '',
            chartRefreshQueued: false,
            chartInstances: {},

            loginForm: { username: '', password: '' },
            loginError: '',

            notifications: [],
            notifSettings: { daysBeforeIntervention: 3 },
            notifReadStatus: {},
            clients: [],
            contracts: [],
            interventions: [],

            editingClientId: null,
            editingContractId: null,
            selectedContractId: null,

            clientForm: { company: '', contact: '', phone: '', email: '', address: '' },
            contractForm: {
                name: '',
                client: '',
                start: '',
                end: '',
                total: 1,
                status: 'Actif',
                planningMode: 'auto',
                manualDatesText: '',
                notes: '',
            },
            interventionForm: {
                client: '',
                contractId: '',
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
                this.persistState();
            },
        },

        contracts: {
            deep: true,
            handler() {
                this.persistState();
                if (this.isAuthenticated) this.queueChartRefresh();
            },
        },

        interventions: {
            deep: true,
            handler() {
                this.persistState();
                this.syncInterventionNotifications();
                if (this.isAuthenticated) this.queueChartRefresh();
            },
        },

        notifSettings: {
            deep: true,
            handler() {
                this.persistState();
                this.syncInterventionNotifications();
            },
        },
    },

    mounted() {
        this.loadState();
        this.isAuthenticated = JSON.parse(localStorage.getItem(AUTH_KEY) || 'false');
    },

    beforeUnmount() {
        Object.keys(this.chartInstances).forEach(id => this.destroyChart(id));
    },

    methods: {
        loadState() {
            const defaults = createDefaultState();
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');

            this.notifSettings = {
                daysBeforeIntervention: Math.max(1, Number(stored?.notifSettings?.daysBeforeIntervention) || 3),
            };
            this.notifReadStatus = stored?.notifReadStatus || {};
            this.clients = Array.isArray(stored?.clients) ? stored.clients.map(client => this.normalizeClient(client)) : defaults.clients;
            this.contracts = (Array.isArray(stored?.contracts) ? stored.contracts : defaults.contracts)
                .map(contract => this.normalizeContract(contract))
                .map(contract => this.migrateContractToCurrentYear(contract));
            this.interventions = (Array.isArray(stored?.interventions) ? stored.interventions : defaults.interventions)
                .map(intervention => this.normalizeIntervention(intervention))
                .map(intervention => this.migrateInterventionToCurrentYear(intervention));
            this.syncInterventionNotifications();
            this.persistState();
        },

        persistState() {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                clients: this.clients,
                contracts: this.contracts,
                interventions: this.interventions,
                notifSettings: this.notifSettings,
                notifReadStatus: this.notifReadStatus,
            }));
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
            const dates = Array.isArray(contract.interventionDates) && contract.interventionDates.length
                ? uniqueSortedDates(contract.interventionDates)
                : generateAutomaticDates(contract.start, contract.end, contract.total || 1);

            return {
                id: contract.id,
                name: contract.name || '',
                client: contract.client || '',
                start: contract.start || dates[0] || '',
                end: contract.end || dates[dates.length - 1] || '',
                total: dates.length || Number(contract.total) || 1,
                status: contract.status || 'Actif',
                planningMode: contract.planningMode || 'auto',
                interventionDates: dates,
                notes: contract.notes || '',
            };
        },

        migrateContractToCurrentYear(contract) {
            const interventionDates = moveDatesToYear(contract.interventionDates);
            const start = moveDateToYear(contract.start || interventionDates[0]) || interventionDates[0] || '';
            const end = moveDateToYear(contract.end || interventionDates[interventionDates.length - 1]) || interventionDates[interventionDates.length - 1] || '';

            return {
                ...contract,
                start,
                end,
                total: interventionDates.length || Number(contract.total) || 1,
                interventionDates,
            };
        },

        normalizeIntervention(intervention) {
            return {
                id: intervention.id,
                client: intervention.client || '',
                contractId: intervention.contractId ?? null,
                date: intervention.date || '',
                priority: intervention.priority || 'Moyenne',
                status: intervention.status || 'Planifié',
                notes: intervention.notes || '',
                source: intervention.source || null,
            };
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

        login() {
            if (this.loginForm.username === 'admin' && this.loginForm.password === 'admin') {
                this.isAuthenticated = true;
                this.loginError = '';
                this.loginForm = { username: '', password: '' };
                this.showToast('Connexion réussie.');
                return;
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
            this.showToast('Client supprimé.');
        },

        openContractModal() {
            this.editingContractId = null;
            this.contractForm = {
                name: '',
                client: '',
                start: '',
                end: '',
                total: 1,
                status: 'Actif',
                planningMode: 'auto',
                manualDatesText: '',
                notes: '',
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
                total: contract.interventionDates.length,
                status: contract.status,
                planningMode: contract.planningMode || 'auto',
                manualDatesText: contract.interventionDates.join('\n'),
                notes: contract.notes || '',
            };
            this.openModal('contractModal');
        },

        openContractDetails(contract) {
            this.selectedContractId = contract.id;
            this.openModal('contractDetailModal');
        },

        submitContract() {
            const dates = this.contractForm.planningMode === 'manual'
                ? parseManualDates(this.contractForm.manualDatesText)
                : generateAutomaticDates(this.contractForm.start, this.contractForm.end, this.contractForm.total);

            if (!dates.length) {
                this.showToast('Ajoutez au moins une date d\'intervention valide.');
                return;
            }

            const contractId = this.editingContractId || Date.now();
            const contract = this.normalizeContract({
                id: contractId,
                name: this.contractForm.name,
                client: this.contractForm.client,
                start: this.contractForm.planningMode === 'auto' ? this.contractForm.start : dates[0],
                end: this.contractForm.planningMode === 'auto' ? this.contractForm.end : dates[dates.length - 1],
                total: dates.length,
                status: this.contractForm.status,
                planningMode: this.contractForm.planningMode,
                interventionDates: dates,
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
            this.closeModal();
        },

        deleteContract(id) {
            if (!confirm('Supprimer ce contrat et les interventions liées ?')) return;

            this.contracts = this.contracts.filter(contract => contract.id !== id);
            this.interventions = this.interventions.filter(intervention => intervention.contractId !== id);

            if (this.selectedContractId === id) this.closeModal();

            this.showToast('Contrat supprimé.');
        },

        syncContractInterventions(contract) {
            const existing = this.interventions.filter(intervention => intervention.contractId === contract.id);
            const existingByDate = new Map(existing.map(intervention => [intervention.date, intervention]));

            const synced = contract.interventionDates.map(date => {
                const current = existingByDate.get(date);

                if (current) {
                    return {
                        ...current,
                        client: contract.client,
                    };
                }

                return {
                    id: `INT-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                    client: contract.client,
                    contractId: contract.id,
                    date,
                    priority: 'Moyenne',
                    status: 'Planifié',
                    notes: '',
                    source: 'contract',
                };
            });

            this.interventions = [
                ...this.interventions.filter(intervention => intervention.contractId !== contract.id),
                ...synced,
            ].sort((left, right) => new Date(left.date) - new Date(right.date));
        },

        openInterventionModal() {
            this.interventionForm = {
                client: '',
                contractId: '',
                date: '',
                priority: 'Moyenne',
                status: 'Planifié',
                notes: '',
            };
            this.openModal('interventionModal');
        },

        addIntervention() {
            const payload = this.normalizeIntervention({
                id: `INT-${Date.now()}`,
                client: this.interventionForm.client,
                contractId: this.interventionForm.contractId ? Number(this.interventionForm.contractId) : null,
                date: this.interventionForm.date,
                priority: this.interventionForm.priority,
                status: this.interventionForm.status,
                notes: this.interventionForm.notes,
                source: 'manual',
            });

            this.interventions.push(payload);
            this.closeModal();
            this.showToast('Intervention planifiée avec succès !');
        },

        deleteIntervention(id) {
            if (!confirm('Confirmer la suppression ?')) return;

            this.interventions = this.interventions.filter(intervention => intervention.id !== id);
            this.showToast('Intervention supprimée.');
        },

        updateInterventionStatus(id, status) {
            const intervention = this.interventions.find(item => item.id === id);
            if (!intervention) return;
            intervention.status = status;
        },

        clientContractCount(company) {
            return this.contracts.filter(contract => contract.client === company).length;
        },

        contractCompletedCount(contract) {
            return this.interventions.filter(intervention => intervention.contractId === contract.id && intervention.status === 'Terminé').length;
        },

        contractCompletionPercent(contract) {
            if (!contract.interventionDates.length) return 0;
            return Math.round((this.contractCompletedCount(contract) / contract.interventionDates.length) * 100);
        },

        contractInterventions(contractId) {
            return this.interventions
                .filter(intervention => intervention.contractId === contractId)
                .sort((left, right) => new Date(left.date) - new Date(right.date));
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
    },

}).mount('#app');
