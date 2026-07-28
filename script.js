/**
 * PlombTrack — Application Vue 3 (Options API)
 */
const { createApp } = Vue;

const STORAGE_KEY = 'plombtrack-storage-v2';
const AUTH_KEY = 'plombtrack-auth-v1';
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000/api' : '/api';
const INTERVENTION_STATUSES = ['Planifié', 'En cours', 'Terminé', 'Annulé'];
const INTERVENTION_TYPES = { CHAUDIERE: 'chaudiere', BRULEUR: 'bruleur', CHAUDIERE_BRULEUR: 'chaudiere_bruleur' };
const FORM_MODALS = ['clientModal', 'contractModal', 'interventionModal', 'invoiceModal', 'stockProductModal', 'stockMovementModal'];

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

function parseContractQuotas(raw, contract = {}) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (raw.chaudiereTotal != null || raw.bruleurTotal != null) {
            return {
                chaudiereTotal: Math.max(0, Number(raw.chaudiereTotal) || 0),
                bruleurTotal: Math.max(0, Number(raw.bruleurTotal) || 0),
            };
        }

        const chaudiereDates = uniqueSortedDates(raw.chaudiereDates || raw.chaudiere || []);
        const bruleurDates = uniqueSortedDates(raw.bruleurDates || raw.bruleur || []);
        return {
            chaudiereTotal: chaudiereDates.length,
            bruleurTotal: bruleurDates.length,
        };
    }

    if (Array.isArray(raw)) {
        return { chaudiereTotal: raw.length, bruleurTotal: 0 };
    }

    if (contract.chaudiereTotal != null || contract.bruleurTotal != null) {
        return {
            chaudiereTotal: Math.max(0, Number(contract.chaudiereTotal) || 0),
            bruleurTotal: Math.max(0, Number(contract.bruleurTotal) || 0),
        };
    }

    const legacyTotal = Math.max(0, Number(contract.total) || 0);
    return { chaudiereTotal: legacyTotal, bruleurTotal: 0 };
}

function contractTotalInterventions(contract) {
    return (Number(contract.chaudiereTotal) || 0) + (Number(contract.bruleurTotal) || 0);
}

function serializeContractQuotas(contract) {
    return {
        chaudiereTotal: Math.max(0, Number(contract.chaudiereTotal) || 0),
        bruleurTotal: Math.max(0, Number(contract.bruleurTotal) || 0),
    };
}

function interventionTypeLabel(type) {
    if (type === INTERVENTION_TYPES.BRULEUR) return 'Brûleur';
    if (type === INTERVENTION_TYPES.CHAUDIERE) return 'Chaudière';
    if (type === INTERVENTION_TYPES.CHAUDIERE_BRULEUR) return 'Chaudière et Brûleur';
    return '—';
}

function interventionTypeRowClass(type) {
    if (type === INTERVENTION_TYPES.BRULEUR) return 'intervention-row-bruleur';
    if (type === INTERVENTION_TYPES.CHAUDIERE) return 'intervention-row-chaudiere';
    if (type === INTERVENTION_TYPES.CHAUDIERE_BRULEUR) return 'intervention-row-chaudiere-bruleur';
    return '';
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
            chaudiereTotal: 4,
            bruleurTotal: 2,
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
            chaudiereTotal: 3,
            bruleurTotal: 5,
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
            chaudiereTotal: 2,
            bruleurTotal: 2,
            notes: 'Dates imposées par le syndic.',
        },
    ];
}

function createDefaultState() {
    return {
        clients: createDefaultClients(),
        contracts: createDefaultContracts(),
        interventions: [],
    };
}

function createDefaultInvoiceSettings() {
    return {
        companyName: 'Ets Bellal Salim',
        contactName: '',
        address: '',
        email: '',
        phone: '',
        nif: '',
        registrationNumber: '',
        rip: '',
        logoMode: 'text',
        logoText: 'Ets Bellal Salim',
        logoImage: '',
        cachetImage: '',
        invoiceLanguage: 'fr',
        defaultTaxRate: 20,
        currency: 'DZD',
        paymentTermsDays: 7,
        footerNotes: '',
    };
}

function createEmptyInvoiceItem() {
    return { description: '', quantity: 1, unitPrice: 0 };
}

function createDefaultInvoiceForm(settings = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date();
    due.setDate(due.getDate() + (Number(settings.paymentTermsDays) || 7));
    return {
        number: '',
        clientId: '',
        documentType: 'facture',
        issueDate: today,
        dueDate: due.toISOString().slice(0, 10),
        status: 'draft',
        currency: settings.currency || 'DZD',
        notes: '',
        adjustment: 0,
        discountAmount: 0,
        taxRate: Number(settings.defaultTaxRate) || 0,
        items: [createEmptyInvoiceItem()],
        clientNif: '',
        clientRc: '',
        clientNis: '',
        includeCachet: false,
    };
}

function createDefaultStockProductForm() {
    return {
        name: '',
        reference: '',
        picture: '',
        buyPrice: 0,
        salePrice: 0,
        lowStockThreshold: 0,
        notes: '',
        initialQuantity: 0,
    };
}

function createDefaultStockMovementForm(product = null) {
    const today = new Date().toISOString().slice(0, 10);
    return {
        productId: product?.id || '',
        type: 'in',
        quantity: 1,
        newQuantity: product ? Number(product.quantity) || 0 : 0,
        unitPrice: product ? Number(product.buyPrice) || 0 : 0,
        reason: '',
        movementDate: today,
    };
}

function formatStockMoney(value) {
    const amount = Number(value) || 0;
    return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} DZD`;
}

function stockMovementTypeLabel(type) {
    if (type === 'in') return 'Entrée';
    if (type === 'out') return 'Sortie';
    if (type === 'adjustment') return 'Ajustement';
    return type;
}

function stockMovementTypeClass(type) {
    if (type === 'in') return 'stock-movement-in';
    if (type === 'out') return 'stock-movement-out';
    if (type === 'adjustment') return 'stock-movement-adjustment';
    return '';
}

function computeInvoiceTotals(items, adjustment, taxRate, discountAmount = 0) {
    const subtotal = (items || []).reduce((sum, item) => {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || 0;
        return sum + qty * price;
    }, 0);
    const roundedSubtotal = Math.round(subtotal * 100) / 100;
    const adj = Number(adjustment) || 0;
    const discount = Math.max(0, Number(discountAmount) || 0);
    const adjustedSubtotal = Math.round((roundedSubtotal + adj) * 100) / 100;
    const taxableSubtotal = Math.round(Math.max(0, adjustedSubtotal - discount) * 100) / 100;
    const tax = Math.round(taxableSubtotal * (Number(taxRate) || 0) / 100 * 100) / 100;
    const total = Math.round((taxableSubtotal + tax) * 100) / 100;
    return { subtotal: roundedSubtotal, adjustment: adj, discount, adjustedSubtotal, taxableSubtotal, tax, total };
}

const INVOICE_LABELS = {
    en: {
        title: 'Invoice',
        proformaTitle: 'Proforma',
        invoiceNumber: 'Invoice Number:',
        proformaNumber: 'Proforma Number:',
        issueDate: 'Date of Issue:',
        dueDate: 'Date Due:',
        seller: 'From:',
        billTo: 'Bill To:',
        client: 'Client:',
        description: 'Description',
        quantity: 'Qty',
        unitPrice: 'Unit price',
        amount: 'Amount',
        notes: 'Notes:',
        subtotal: 'Subtotal',
        adjustments: 'Adjustments',
        discount: 'Discount',
        adjustedSubtotal: 'Adjusted Subtotal',
        tax: 'Tax',
        total: 'Total',
        nif: 'NIF:',
        rc: 'R.C:',
        nis: 'NIS:',
        registrationNumber: 'Registration No.:',
        rip: 'RIP:',
    },
    fr: {
        title: 'Facture',
        proformaTitle: 'Proforma',
        invoiceNumber: 'Numéro de facture :',
        proformaNumber: 'Numéro proforma :',
        issueDate: "Date d'émission :",
        dueDate: "Date d'échéance :",
        seller: 'Émetteur :',
        billTo: 'Facturé à :',
        client: 'Client :',
        description: 'Description',
        quantity: 'Qté',
        unitPrice: 'Prix unitaire',
        amount: 'Montant',
        notes: 'Notes :',
        subtotal: 'Sous-total',
        adjustments: 'Ajustements',
        discount: 'Remise',
        adjustedSubtotal: 'Sous-total ajusté',
        tax: 'TVA',
        total: 'Total',
        nif: 'NIF :',
        rc: 'R.C :',
        nis: 'NIS :',
        registrationNumber: "N° d'immatriculation :",
        rip: 'RIP :',
    },
};

function invoiceDocumentLabels(language, documentType = 'facture') {
    const labels = invoiceLabels(language);
    if ((documentType || 'facture').toLowerCase() === 'proforma') {
        return {
            ...labels,
            title: labels.proformaTitle || 'Proforma',
            invoiceNumber: labels.proformaNumber || labels.invoiceNumber,
        };
    }
    return labels;
}

function invoiceDocumentTypeLabel(documentType) {
    return (documentType || 'facture').toLowerCase() === 'proforma' ? 'Proforma' : 'Facture';
}

function invoiceLabels(language = 'fr') {
    return INVOICE_LABELS[language] || INVOICE_LABELS.fr;
}

function formatInvoiceMoney(amount, currency = 'DZD') {
    const value = Number(amount) || 0;
    const symbols = { DZD: 'DA', EUR: '€', USD: '$' };
    const symbol = symbols[currency] || currency;
    const formatted = value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (symbol === '€' || symbol === '$') return `${symbol}${formatted}`;
    return `${formatted} ${symbol}`;
}

function formatInvoiceDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('fr-FR');
}

function invoiceStatusLabel(status) {
    const labels = {
        draft: 'Brouillon',
        sent: 'Envoyée',
        paid: 'Payée',
        cancelled: 'Annulée',
    };
    return labels[status] || status;
}

createApp({

    data() {
        return {
            isAuthenticated: false,
            currentPage: 'dashboard',
            sidebarOpen: false,
            activeModal: null,
            showCloseConfirm: false,
            formSnapshot: null,
            toastMessage: '',
            toastVisible: false,
            notificationsOpen: false,
            interventionView: 'list',
            interventionFilterType: '',
            interventionFilterClient: '',
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

            clientForm: { company: '', contact: '', phone: '', email: '', address: '', nif: '', rc: '', nis: '' },
            contractForm: {
                name: '',
                client: '',
                start: '',
                end: '',
                status: 'Actif',
                notes: '',
                chaudiereTotal: 0,
                bruleurTotal: 0,
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

            features: { invoices: false, stock: false },
            invoices: [],
            invoiceSearch: '',
            invoiceSettings: createDefaultInvoiceSettings(),
            invoiceSettingsDraft: createDefaultInvoiceSettings(),
            editingInvoiceId: null,
            previewInvoiceId: null,
            invoiceForm: createDefaultInvoiceForm(),

            stockProducts: [],
            stockSummary: { totalProducts: 0, lowStockCount: 0, totalStockValue: 0 },
            stockMovements: [],
            stockTab: 'products',
            stockSearch: '',
            stockLowStockOnly: false,
            stockMovementFilterType: '',
            stockMovementFilterProductId: '',
            stockMovementFilterDateFrom: '',
            stockMovementFilterDateTo: '',
            editingStockProductId: null,
            stockProductForm: createDefaultStockProductForm(),
            stockMovementForm: createDefaultStockMovementForm(),
            stockProductDetail: null,
            stockProductDetailMovements: [],
            stockProductDetailLoading: false,
            stockMovementReturnProductId: null,
        };
    },

    computed: {
        pageTitle() {
            const titles = {
                dashboard: 'Tableau de bord',
                clients: 'Clients',
                contracts: 'Contrats',
                interventions: 'Interventions',
                invoices: 'Factures',
                stock: 'Stock',
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

            const clientQuery = this.interventionFilterClient.trim().toLowerCase();
            if (clientQuery) {
                items = items.filter(intervention =>
                    (intervention.client || '').toLowerCase().includes(clientQuery)
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
            return true;
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

        filteredInvoices() {
            const q = this.invoiceSearch.toLowerCase();
            return this.invoices.filter(invoice => {
                const clientName = invoice.client?.company || '';
                return (
                    String(invoice.number).toLowerCase().includes(q)
                    || clientName.toLowerCase().includes(q)
                    || invoiceStatusLabel(invoice.status).toLowerCase().includes(q)
                );
            });
        },

        invoiceFormTotals() {
            return computeInvoiceTotals(
                this.invoiceForm.items,
                this.invoiceForm.adjustment,
                this.invoiceForm.taxRate,
                this.invoiceForm.discountAmount
            );
        },

        previewInvoice() {
            if (this.previewInvoiceId) {
                return this.invoices.find(invoice => invoice.id === this.previewInvoiceId) || null;
            }
            return null;
        },

        previewInvoiceClient() {
            return this.previewInvoice?.client || this.clients.find(c => c.id === Number(this.invoiceForm.clientId)) || null;
        },

        selectedInvoiceClient() {
            if (!this.invoiceForm.clientId) return null;
            return this.clients.find(c => c.id === Number(this.invoiceForm.clientId)) || null;
        },

        invoiceText() {
            const documentType = this.previewInvoice?.documentType || this.invoiceForm.documentType || 'facture';
            return invoiceDocumentLabels(this.invoiceSettings.invoiceLanguage, documentType);
        },

        previewDocumentTitle() {
            return invoiceDocumentTypeLabel(this.previewInvoice?.documentType);
        },

        filteredStockProducts() {
            const q = this.stockSearch.toLowerCase();
            return this.stockProducts.filter(product => {
                const matchesSearch = (
                    (product.name || '').toLowerCase().includes(q)
                    || (product.reference || '').toLowerCase().includes(q)
                );
                if (!matchesSearch) return false;
                if (this.stockLowStockOnly && !product.isLowStock) return false;
                return true;
            });
        },

        filteredStockMovements() {
            return this.stockMovements;
        },

        selectedStockMovementProduct() {
            if (!this.stockMovementForm.productId) return null;
            return this.stockProducts.find(product => product.id === Number(this.stockMovementForm.productId)) || null;
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

        interventionFilterClient() {
            this.interventionPage = 1;
        },

        interventionFilterStart() {
            this.interventionPage = 1;
        },

        interventionFilterEnd() {
            this.interventionPage = 1;
        },

        'invoiceForm.clientId'(clientId) {
            if (!clientId) {
                this.invoiceForm.clientNif = '';
                this.invoiceForm.clientRc = '';
                this.invoiceForm.clientNis = '';
                return;
            }
            const client = this.clients.find(c => c.id === Number(clientId));
            this.invoiceForm.clientNif = client?.nif || '';
            this.invoiceForm.clientRc = client?.rc || '';
            this.invoiceForm.clientNis = client?.nis || '';
        },

        'stockMovementForm.productId'(productId) {
            const product = this.stockProducts.find(item => item.id === Number(productId));
            if (!product) return;
            if (this.stockMovementForm.type === 'adjustment') {
                this.stockMovementForm.newQuantity = Number(product.quantity) || 0;
            }
            if (!this.stockMovementForm.unitPrice) {
                this.stockMovementForm.unitPrice = this.defaultStockMovementUnitPrice(product, this.stockMovementForm.type);
            }
        },

        'stockMovementForm.type'(movementType) {
            const product = this.selectedStockMovementProduct;
            if (!product) return;
            if (movementType === 'adjustment') {
                this.stockMovementForm.newQuantity = Number(product.quantity) || 0;
            }
            this.stockMovementForm.unitPrice = this.defaultStockMovementUnitPrice(product, movementType);
        },

        interventionTotalPages(total) {
            if (this.interventionPage > total) this.interventionPage = total;
        },

    },

    async mounted() {
        await this.loadConfig();
        await this.loadState();
        this.isAuthenticated = JSON.parse(localStorage.getItem(AUTH_KEY) || 'false');
        if (this.isAuthenticated && this.features.invoices) {
            await this.loadInvoices();
            await this.loadInvoiceSettings();
        }
        if (this.isAuthenticated && this.features.stock) {
            await this.loadStock();
        }
        this._onEscapeKey = (event) => {
            if (event.key === 'Escape') this.handleEscapeKey();
        };
        document.addEventListener('keydown', this._onEscapeKey);
    },

    beforeUnmount() {
        document.removeEventListener('keydown', this._onEscapeKey);
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

        async loadConfig() {
            try {
                const config = await this.apiRequest('/config');
                this.features = {
                    invoices: Boolean(config?.features?.invoices),
                    stock: Boolean(config?.features?.stock),
                };
            } catch (error) {
                console.error('Unable to load API config.', error);
                this.features = { invoices: false, stock: false };
            }
        },

        async loadInvoices() {
            if (!this.features.invoices) return;
            try {
                this.invoices = await this.apiRequest('/invoices');
            } catch (error) {
                console.error('Unable to load invoices.', error);
                this.showToast('Impossible de charger les factures.');
            }
        },

        async loadInvoiceSettings() {
            if (!this.features.invoices) return;
            try {
                const settings = await this.apiRequest('/invoice-settings');
                this.invoiceSettings = { ...createDefaultInvoiceSettings(), ...settings };
                this.invoiceSettingsDraft = { ...this.invoiceSettings };
            } catch (error) {
                console.error('Unable to load invoice settings.', error);
            }
        },

        async saveInvoiceSettings() {
            if (!this.features.invoices) return;
            try {
                const saved = await this.apiRequest('/invoice-settings', {
                    method: 'PUT',
                    body: JSON.stringify(this.invoiceSettingsDraft),
                });
                this.invoiceSettings = { ...createDefaultInvoiceSettings(), ...saved };
                this.invoiceSettingsDraft = { ...this.invoiceSettings };
                this.showToast('Paramètres de facturation enregistrés.');
            } catch (error) {
                console.error('Unable to save invoice settings.', error);
                this.showToast('Sauvegarde des paramètres impossible.');
            }
        },

        onInvoiceLogoFileChange(event) {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                this.invoiceSettingsDraft.logoImage = String(reader.result || '');
                this.invoiceSettingsDraft.logoMode = 'image';
            };
            reader.readAsDataURL(file);
        },

        onInvoiceCachetFileChange(event) {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                this.invoiceSettingsDraft.cachetImage = String(reader.result || '');
            };
            reader.readAsDataURL(file);
        },

        removeInvoiceCachet() {
            this.invoiceSettingsDraft.cachetImage = '';
            if (this.invoiceForm.includeCachet) {
                this.invoiceForm.includeCachet = false;
            }
        },

        openInvoiceModal() {
            this.editingInvoiceId = null;
            this.invoiceForm = createDefaultInvoiceForm(this.invoiceSettings);
            this.openModal('invoiceModal');
        },

        onInvoiceDocumentTypeChange() {
            if ((this.invoiceForm.documentType || 'facture').toLowerCase() === 'proforma') {
                this.invoiceForm.dueDate = '';
                if (this.invoiceForm.clientId) {
                    const client = this.clients.find(c => c.id === Number(this.invoiceForm.clientId));
                    this.invoiceForm.clientNif = client?.nif || '';
                    this.invoiceForm.clientRc = client?.rc || '';
                    this.invoiceForm.clientNis = client?.nis || '';
                }
            } else if (!this.invoiceForm.dueDate) {
                const due = new Date(this.invoiceForm.issueDate || new Date());
                due.setDate(due.getDate() + (Number(this.invoiceSettings.paymentTermsDays) || 7));
                this.invoiceForm.dueDate = due.toISOString().slice(0, 10);
            }
        },

        startEditInvoice(invoice) {
            this.editingInvoiceId = invoice.id;
            this.invoiceForm = {
                number: invoice.number,
                clientId: invoice.clientId,
                documentType: invoice.documentType || 'facture',
                issueDate: invoice.issueDate,
                dueDate: invoice.dueDate,
                status: invoice.status,
                currency: invoice.currency,
                notes: invoice.notes || '',
                adjustment: invoice.adjustment || 0,
                discountAmount: invoice.discountAmount || invoice.totals?.discount || 0,
                taxRate: invoice.taxRate || 0,
                clientNif: invoice.client?.nif || '',
                clientRc: invoice.client?.rc || '',
                clientNis: invoice.client?.nis || '',
                includeCachet: Boolean(invoice.includeCachet),
                items: (invoice.items || []).map(item => ({
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                })),
            };
            if (!this.invoiceForm.items.length) {
                this.invoiceForm.items = [createEmptyInvoiceItem()];
            }
            this.openModal('invoiceModal');
        },

        openInvoicePreview(invoice) {
            this.previewInvoiceId = invoice.id;
            this.openModal('invoicePreviewModal');
        },

        addInvoiceLine() {
            this.invoiceForm.items.push(createEmptyInvoiceItem());
        },

        removeInvoiceLine(index) {
            if (this.invoiceForm.items.length <= 1) return;
            this.invoiceForm.items.splice(index, 1);
        },

        invoiceLineAmount(item) {
            return Math.round((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) * 100) / 100;
        },

        async saveInvoiceClientIdentifiers() {
            const clientId = Number(this.invoiceForm.clientId);
            if (!clientId) return;

            const nif = (this.invoiceForm.clientNif || '').trim();
            const rc = (this.invoiceForm.clientRc || '').trim();
            const nis = (this.invoiceForm.clientNis || '').trim();
            const client = this.clients.find(c => c.id === clientId);
            if (!client || (client.nif === nif && client.rc === rc && client.nis === nis)) return;

            this.clients = this.clients.map(c => (
                c.id === clientId ? { ...c, nif, rc, nis } : c
            ));
            const state = {
                clients: this.clients,
                contracts: this.contracts,
                interventions: this.interventions,
                notifSettings: this.notifSettings,
                notifReadStatus: this.notifReadStatus,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            const saved = await this.apiRequest('/state', {
                method: 'PUT',
                body: JSON.stringify(state),
            });
            this.clients = saved.clients.map(client => this.normalizeClient(client));
        },

        async submitInvoice() {
            if (!this.invoiceForm.clientId) {
                this.showToast('Sélectionnez un client.');
                return;
            }
            const items = this.invoiceForm.items
                .map((item, index) => ({
                    description: (item.description || '').trim(),
                    quantity: Number(item.quantity) || 0,
                    unitPrice: Number(item.unitPrice) || 0,
                    sortOrder: index,
                }))
                .filter(item => item.description);
            if (!items.length) {
                this.showToast('Ajoutez au moins une ligne de facture.');
                return;
            }

            const isProforma = (this.invoiceForm.documentType || 'facture').toLowerCase() === 'proforma';
            const payload = {
                number: this.invoiceForm.number || null,
                clientId: Number(this.invoiceForm.clientId),
                documentType: this.invoiceForm.documentType || 'facture',
                issueDate: this.invoiceForm.issueDate,
                dueDate: isProforma ? '' : this.invoiceForm.dueDate,
                status: this.invoiceForm.status,
                currency: this.invoiceForm.currency,
                notes: this.invoiceForm.notes,
                adjustment: Number(this.invoiceForm.adjustment) || 0,
                discountAmount: Number(this.invoiceForm.discountAmount) || 0,
                taxRate: Number(this.invoiceForm.taxRate) || 0,
                includeCachet: Boolean(this.invoiceForm.includeCachet),
                items,
            };

            try {
                if (isProforma) {
                    await this.saveInvoiceClientIdentifiers();
                }
                if (this.editingInvoiceId) {
                    await this.apiRequest(`/invoices/${this.editingInvoiceId}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload),
                    });
                    this.showToast('Facture mise à jour.');
                } else {
                    await this.apiRequest('/invoices', {
                        method: 'POST',
                        body: JSON.stringify(payload),
                    });
                    this.showToast('Facture créée.');
                }
                await this.loadInvoices();
                this.closeModal();
            } catch (error) {
                console.error('Unable to save invoice.', error);
                this.showToast(error.message || 'Sauvegarde de la facture impossible.');
            }
        },

        async deleteInvoice(id) {
            if (!confirm('Supprimer cette facture ?')) return;
            try {
                await this.apiRequest(`/invoices/${id}`, { method: 'DELETE' });
                this.invoices = this.invoices.filter(invoice => invoice.id !== id);
                if (this.previewInvoiceId === id) this.closeModal();
                this.showToast('Facture supprimée.');
            } catch (error) {
                console.error('Unable to delete invoice.', error);
                this.showToast('Suppression impossible.');
            }
        },

        async exportInvoice(invoiceId, format) {
            const path = format === 'pdf'
                ? `/invoices/${invoiceId}/export.pdf`
                : `/invoices/${invoiceId}/export.xlsx`;
            try {
                const response = await fetch(`${this.apiBase}${path}`);
                if (!response.ok) throw new Error('Export failed');
                const blob = await response.blob();
                const invoice = this.invoices.find(item => item.id === invoiceId);
                const extension = format === 'pdf' ? 'pdf' : 'xlsx';
                const filename = `invoice-${invoice?.number || invoiceId}.${extension}`;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                this.showToast(`Export ${format.toUpperCase()} téléchargé.`);
            } catch (error) {
                console.error('Unable to export invoice.', error);
                this.showToast('Export impossible.');
            }
        },

        formatInvoiceMoney,
        formatInvoiceDate,
        invoiceStatusLabel,
        invoiceDocumentTypeLabel,
        invoiceLabels,
        invoiceStatusClass(status) {
            if (status === 'paid') return 'badge-active';
            if (status === 'cancelled') return 'badge-danger';
            if (status === 'sent') return 'badge-pending';
            return 'badge-pending';
        },

        async loadStock() {
            if (!this.features.stock) return;
            try {
                const [productsResponse, movements] = await Promise.all([
                    this.apiRequest('/stock/products'),
                    this.apiRequest(this.buildStockMovementsQuery()),
                ]);
                this.stockProducts = productsResponse?.products || [];
                this.stockSummary = productsResponse?.summary || {
                    totalProducts: 0,
                    lowStockCount: 0,
                    totalStockValue: 0,
                };
                this.stockMovements = movements || [];
            } catch (error) {
                console.error('Unable to load stock.', error);
                this.showToast('Impossible de charger le stock.');
            }
        },

        buildStockMovementsQuery() {
            const params = new URLSearchParams();
            if (this.stockMovementFilterProductId) {
                params.set('product_id', String(this.stockMovementFilterProductId));
            }
            if (this.stockMovementFilterType) {
                params.set('type', this.stockMovementFilterType);
            }
            if (this.stockMovementFilterDateFrom) {
                params.set('date_from', this.stockMovementFilterDateFrom);
            }
            if (this.stockMovementFilterDateTo) {
                params.set('date_to', this.stockMovementFilterDateTo);
            }
            const query = params.toString();
            return query ? `/stock/movements?${query}` : '/stock/movements';
        },

        async reloadStockMovements() {
            if (!this.features.stock) return;
            try {
                this.stockMovements = await this.apiRequest(this.buildStockMovementsQuery());
            } catch (error) {
                console.error('Unable to load stock movements.', error);
                this.showToast('Impossible de charger les mouvements.');
            }
        },

        openStockProductModal() {
            this.editingStockProductId = null;
            this.stockProductForm = createDefaultStockProductForm();
            this.openModal('stockProductModal');
        },

        startEditStockProduct(product) {
            this.editingStockProductId = product.id;
            this.stockProductForm = {
                name: product.name,
                reference: product.reference || '',
                picture: product.picture || '',
                buyPrice: product.buyPrice || 0,
                salePrice: product.salePrice || 0,
                lowStockThreshold: product.lowStockThreshold || 0,
                notes: product.notes || '',
                initialQuantity: 0,
            };
            this.openModal('stockProductModal');
        },

        openStockMovementModal(product = null) {
            this.stockMovementForm = createDefaultStockMovementForm(product);
            if (product) {
                this.stockMovementForm.unitPrice = this.defaultStockMovementUnitPrice(product, this.stockMovementForm.type);
            }
            this.openModal('stockMovementModal');
        },

        async openStockProductDetail(product) {
            if (!product?.id) return;
            this.stockProductDetail = product;
            this.stockProductDetailMovements = [];
            this.stockProductDetailLoading = true;
            this.openModal('stockProductDetailModal');
            try {
                const [detail, movements] = await Promise.all([
                    this.apiRequest(`/stock/products/${product.id}`),
                    this.apiRequest(`/stock/movements?product_id=${product.id}`),
                ]);
                this.stockProductDetail = detail;
                this.stockProductDetailMovements = movements || [];
            } catch (error) {
                console.error('Unable to load product detail.', error);
                this.showToast('Impossible de charger le détail du produit.');
            } finally {
                this.stockProductDetailLoading = false;
            }
        },

        openStockMovementFromDetail() {
            const product = this.stockProductDetail;
            this.stockMovementReturnProductId = product?.id || null;
            this.closeModal();
            this.$nextTick(() => {
                this.openStockMovementModal(product);
            });
        },

        editStockProductFromDetail() {
            const product = this.stockProductDetail;
            this.closeModal();
            this.$nextTick(() => {
                this.startEditStockProduct(product);
            });
        },

        defaultStockMovementUnitPrice(product, movementType) {
            if (movementType === 'out') {
                return Number(product.salePrice) || Number(product.buyPrice) || 0;
            }
            return Number(product.buyPrice) || 0;
        },

        onStockProductPictureChange(event) {
            const file = event.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                this.stockProductForm.picture = String(reader.result || '');
            };
            reader.readAsDataURL(file);
        },

        removeStockProductPicture() {
            this.stockProductForm.picture = '';
        },

        async submitStockProduct() {
            const name = (this.stockProductForm.name || '').trim();
            if (!name) {
                this.showToast('Le nom du produit est obligatoire.');
                return;
            }

            const payload = {
                name,
                reference: (this.stockProductForm.reference || '').trim(),
                picture: this.stockProductForm.picture || '',
                buyPrice: Number(this.stockProductForm.buyPrice) || 0,
                salePrice: Number(this.stockProductForm.salePrice) || 0,
                lowStockThreshold: Number(this.stockProductForm.lowStockThreshold) || 0,
                notes: (this.stockProductForm.notes || '').trim(),
            };

            try {
                if (this.editingStockProductId) {
                    await this.apiRequest(`/stock/products/${this.editingStockProductId}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload),
                    });
                    this.showToast('Produit mis à jour.');
                } else {
                    await this.apiRequest('/stock/products', {
                        method: 'POST',
                        body: JSON.stringify({
                            ...payload,
                            initialQuantity: Number(this.stockProductForm.initialQuantity) || 0,
                        }),
                    });
                    this.showToast('Produit créé.');
                }
                await this.loadStock();
                this.closeModal();
            } catch (error) {
                console.error('Unable to save stock product.', error);
                this.showToast(error.message || 'Sauvegarde du produit impossible.');
            }
        },

        async deleteStockProduct(id) {
            if (!confirm('Supprimer ce produit ?')) return;
            try {
                await this.apiRequest(`/stock/products/${id}`, { method: 'DELETE' });
                await this.loadStock();
                this.showToast('Produit supprimé.');
            } catch (error) {
                console.error('Unable to delete stock product.', error);
                this.showToast(error.message || 'Suppression impossible.');
            }
        },

        async submitStockMovement() {
            if (!this.stockMovementForm.productId) {
                this.showToast('Sélectionnez un produit.');
                return;
            }

            const payload = {
                productId: Number(this.stockMovementForm.productId),
                type: this.stockMovementForm.type,
                quantity: Number(this.stockMovementForm.quantity) || 0,
                unitPrice: Number(this.stockMovementForm.unitPrice) || 0,
                reason: (this.stockMovementForm.reason || '').trim(),
                movementDate: this.stockMovementForm.movementDate,
            };

            if (this.stockMovementForm.type === 'adjustment') {
                payload.newQuantity = Number(this.stockMovementForm.newQuantity);
            }

            try {
                await this.apiRequest('/stock/movements', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
                this.showToast('Mouvement enregistré.');
                const returnProductId = this.stockMovementReturnProductId;
                this.stockMovementReturnProductId = null;
                await this.loadStock();
                this.closeModal();
                if (returnProductId) {
                    const product = this.stockProducts.find(item => item.id === returnProductId);
                    if (product) await this.openStockProductDetail(product);
                }
            } catch (error) {
                console.error('Unable to save stock movement.', error);
                this.showToast(error.message || 'Enregistrement du mouvement impossible.');
            }
        },

        async applyStockMovementFilters() {
            await this.reloadStockMovements();
        },

        formatStockMoney,
        formatStockDate(value) {
            return formatInvoiceDate(value);
        },
        stockMovementTypeLabel,
        stockMovementTypeClass,

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
                .map(contract => this.normalizeContract(contract));
            this.interventions = (Array.isArray(stored?.interventions) ? stored.interventions : defaults.interventions)
                .map(intervention => this.normalizeIntervention(intervention));
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
                nif: client.nif || '',
                rc: client.rc || '',
                nis: client.nis || '',
            };
        },

        normalizeContract(contract) {
            const quotas = parseContractQuotas(
                contract.chaudiereTotal != null || contract.bruleurTotal != null
                    ? { chaudiereTotal: contract.chaudiereTotal, bruleurTotal: contract.bruleurTotal }
                    : contract.chaudiereDates || contract.bruleurDates
                        ? { chaudiereDates: contract.chaudiereDates, bruleurDates: contract.bruleurDates }
                        : contract.interventionDates,
                contract
            );

            return {
                id: contract.id,
                name: contract.name || '',
                client: contract.client || '',
                start: contract.start || '',
                end: contract.end || '',
                total: contractTotalInterventions(quotas),
                status: contract.status || 'Actif',
                chaudiereTotal: quotas.chaudiereTotal,
                bruleurTotal: quotas.bruleurTotal,
                notes: contract.notes || '',
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
                if (this.features.invoices) {
                    await this.loadInvoices();
                    await this.loadInvoiceSettings();
                }
                if (this.features.stock) {
                    await this.loadStock();
                }
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
            this.closeModal();
            this.currentPage = 'dashboard';
            this.loginError = '';
        },

        navigate(page) {
            if (page === 'invoices' && !this.features.invoices) return;
            if (page === 'stock' && !this.features.stock) return;
            this.currentPage = page;
            this.notificationsOpen = false;
            if (window.innerWidth <= 768) this.sidebarOpen = false;
            if (page === 'parametres') {
                this.notifDaysDraft = String(this.notifSettings.daysBeforeIntervention);
                if (this.features.invoices) {
                    this.invoiceSettingsDraft = { ...this.invoiceSettings };
                }
            }
            if (page === 'interventions') {
                this.interventionPage = 1;
            }
            if (page === 'invoices' && this.features.invoices) {
                this.loadInvoices();
            }
            if (page === 'stock' && this.features.stock) {
                this.loadStock();
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

        isFormModal(name) {
            return FORM_MODALS.includes(name);
        },

        getActiveFormSnapshot() {
            switch (this.activeModal) {
                case 'clientModal':
                    return JSON.stringify(this.clientForm);
                case 'contractModal':
                    return JSON.stringify(this.contractForm);
                case 'interventionModal':
                    return JSON.stringify(this.interventionForm);
                case 'invoiceModal':
                    return JSON.stringify(this.invoiceForm);
                case 'stockProductModal':
                    return JSON.stringify(this.stockProductForm);
                case 'stockMovementModal':
                    return JSON.stringify(this.stockMovementForm);
                default:
                    return null;
            }
        },

        captureFormSnapshot() {
            this.formSnapshot = this.getActiveFormSnapshot();
        },

        isActiveFormDirty() {
            if (!this.isFormModal(this.activeModal) || this.formSnapshot === null) return false;
            return this.getActiveFormSnapshot() !== this.formSnapshot;
        },

        openModal(name) {
            this.activeModal = name;
            this.showCloseConfirm = false;
            if (this.isFormModal(name)) {
                this.captureFormSnapshot();
            } else {
                this.formSnapshot = null;
            }
        },

        requestCloseModal() {
            if (this.showCloseConfirm) return;
            if (this.isActiveFormDirty()) {
                this.showCloseConfirm = true;
                return;
            }
            this.closeModal();
        },

        confirmDiscardChanges() {
            this.showCloseConfirm = false;
            this.closeModal();
        },

        cancelDiscardChanges() {
            this.showCloseConfirm = false;
        },

        handleEscapeKey() {
            if (this.showCloseConfirm) {
                this.cancelDiscardChanges();
                return;
            }
            if (!this.activeModal) return;
            if (this.isFormModal(this.activeModal)) {
                this.requestCloseModal();
            } else {
                this.closeModal();
            }
        },

        closeModal() {
            this.showCloseConfirm = false;
            this.formSnapshot = null;
            this.activeModal = null;
            this.selectedContractId = null;
            this.previewInvoiceId = null;
            this.stockProductDetailMovements = [];
            this.stockProductDetailLoading = false;
            this.stockMovementReturnProductId = null;
            this.stockProductDetail = null;
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
                    message: `Bonjour Lotfi, vouz avez une intervention chez ${i.client} prévue le ${i.date} (${daysText}).`,
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
            this.clientForm = { company: '', contact: '', phone: '', email: '', address: '', nif: '', rc: '', nis: '' };
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

        openContractModal() {
            this.editingContractId = null;
            this.contractForm = {
                name: '',
                client: '',
                start: '',
                end: '',
                status: 'Actif',
                notes: '',
                chaudiereTotal: 0,
                bruleurTotal: 0,
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
                chaudiereTotal: contract.chaudiereTotal ?? 0,
                bruleurTotal: contract.bruleurTotal ?? 0,
            };
            this.openModal('contractModal');
        },

        openContractDetails(contract) {
            this.selectedContractId = contract.id;
            this.openModal('contractDetailModal');
        },

        submitContract() {
            const chaudiereTotal = Math.max(0, Number(this.contractForm.chaudiereTotal) || 0);
            const bruleurTotal = Math.max(0, Number(this.contractForm.bruleurTotal) || 0);

            if (!chaudiereTotal && !bruleurTotal) {
                this.showToast('Indiquez au moins une intervention prévue (chaudière ou brûleur).');
                return;
            }

            const contractId = this.editingContractId || Date.now();
            const contract = this.normalizeContract({
                id: contractId,
                name: this.contractForm.name,
                client: this.contractForm.client,
                start: this.contractForm.start,
                end: this.contractForm.end,
                status: this.contractForm.status,
                chaudiereTotal,
                bruleurTotal,
                notes: this.contractForm.notes,
            });

            const exists = this.contracts.some(item => item.id === contractId);
            if (exists) {
                this.contracts = this.contracts.map(item => item.id === contractId ? contract : item);
                this.interventions = this.interventions.map(intervention => (
                    intervention.contractId === contractId
                        ? { ...intervention, client: contract.client }
                        : intervention
                ));
                this.showToast('Contrat mis à jour avec succès !');
            } else {
                this.contracts.push(contract);
                this.showToast('Contrat créé avec succès !');
            }

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

        submitIntervention() {
            const existing = this.editingInterventionId
                ? this.interventions.find(item => item.id === this.editingInterventionId)
                : null;
            const linkedContract = this.interventionForm.contractId
                ? this.contracts.find(item => item.id === Number(this.interventionForm.contractId))
                : null;

            const resolvedType = this.interventionTypeEditable
                ? (this.interventionForm.type || INTERVENTION_TYPES.CHAUDIERE)
                : (existing?.type || INTERVENTION_TYPES.CHAUDIERE);

            if (!existing?.contractId && !resolvedType) {
                this.showToast('Sélectionnez un type d\'intervention (Chaudière, Brûleur ou Chaudière et Brûleur).');
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

        interventionTypeRowClass(type) {
            return interventionTypeRowClass(type || INTERVENTION_TYPES.CHAUDIERE);
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
                { value: INTERVENTION_TYPES.BRULEUR, label: 'Brûleur' },
                { value: INTERVENTION_TYPES.CHAUDIERE, label: 'Chaudière' },
                { value: INTERVENTION_TYPES.CHAUDIERE_BRULEUR, label: 'Chaudière et Brûleur' },
            ];
        },
    },

}).mount('#app');
