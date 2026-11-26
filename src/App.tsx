/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {BrowserRouter, Navigate, Route, Routes, useParams} from 'react-router-dom';
import {
  PlatformLoginPage,
  RequirePlatformAdmin,
  RequireTenantMember,
  SetPasswordPage,
  TenantLoginPage,
} from '@/app/AuthPages';
import {HomeHubPage} from '@/app/HomeHubPage';
import {AppErrorBoundary} from '@/components/common/AppErrorBoundary';
import {DirectionProvider} from '@/components/common/DirectionProvider';
import {BranchesPage} from '@/features/branches/BranchesPage';
import {ClientDetailPage} from '@/features/clients/ClientDetailPage';
import {ClientPortalDashboardPage} from '@/features/clients/ClientPortalDashboardPage';
import {ClientPortalFinancePage} from '@/features/clients/ClientPortalFinancePage';
import {ClientPortalPickupPage} from '@/features/clients/ClientPortalPickupPage';
import {ClientsListPage} from '@/features/clients/ClientsListPage';
import {ClientSettlementsPage} from '@/features/clients/ClientSettlementsPage';
import {CommissionListsPage} from '@/features/couriers/CommissionListsPage';
import {CourierMovementsPage} from '@/features/couriers/CourierMovementsPage';
import {CourierRoutesPage} from '@/features/couriers/CourierRoutesPage';
import {CourierSettlementsPage} from '@/features/couriers/CourierSettlementsPage';
import {CouriersListPage} from '@/features/couriers/CouriersListPage';
import {TenantOverviewPage} from '@/features/dashboard/TenantOverviewPage';
import {AccountingRefsPage} from '@/features/definitions/AccountingRefsPage';
import {CashboxesPage} from '@/features/definitions/CashboxesPage';
import {ExceptionsPage} from '@/features/definitions/ExceptionsPage';
import {ServicesPage} from '@/features/definitions/ServicesPage';
import {GeographyPage} from '@/features/geography/GeographyPage';
import {CourierPortalPage} from '@/features/delivery/CourierPortalPage';
import {DeliveryListsPage} from '@/features/delivery/DeliveryListsPage';
import {ReturnsWorkflowPage} from '@/features/delivery/ReturnsWorkflowPage';
import {CourierCollectionsPage} from '@/features/finance/CourierCollectionsPage';
import {FinanceCashboxesPage} from '@/features/finance/FinanceCashboxesPage';
import {JournalEntriesPage} from '@/features/accounting/JournalEntriesPage';
import {TrialBalancePage} from '@/features/accounting/TrialBalancePage';
import {BranchTransfersPage} from '@/features/operations/BranchTransfersPage';
import {PickupListsPage} from '@/features/operations/PickupListsPage';
import {WarehouseIntakePage} from '@/features/operations/WarehouseIntakePage';
import {PriceListDetailPage} from '@/features/pricing/PriceListDetailPage';
import {PriceListsPage} from '@/features/pricing/PriceListsPage';
import {PricingCalculatorPage} from '@/features/pricing/PricingCalculatorPage';
import {RolesPermissionsPage} from '@/features/security/RolesPermissionsPage';
import {SessionAuditPage} from '@/features/security/SessionAuditPage';
import {UsersManagementPage} from '@/features/security/UsersManagementPage';
import {ApiIntegrationsPage} from '@/features/integrations/ApiIntegrationsPage';
import {CreateShipmentPage} from '@/features/shipments/CreateShipmentPage';
import {PublicTrackingPage} from '@/features/shipments/PublicTrackingPage';
import {ShipmentDetailPage} from '@/features/shipments/ShipmentDetailPage';
import {ShipmentsListPage} from '@/features/shipments/ShipmentsListPage';
import {MessagingCenterPage} from '@/features/messaging/MessagingCenterPage';
import {ExecutiveReportsPage} from '@/features/reports/ExecutiveReportsPage';
import {ShipmentsImportPage} from '@/features/reports/ShipmentsImportPage';
import {TenantSettingsPage} from '@/features/settings/TenantSettingsPage';
import {PlatformTenantsPage} from '@/features/tenants/PlatformTenantsPage';
import {TenantAdminShellPage} from '@/features/tenants/TenantAdminShellPage';
import {TenantPublicPage} from '@/features/tenants/TenantPublicPage';
import {AuthProvider} from '@/lib/auth';
import {TenantRuntimeProvider} from '@/lib/tenant/TenantRuntimeContext';
import {getActiveTenantSlug} from '@/lib/tenant/runtimeState';

function ClientPortalEntryRedirect() {
  const {companySlug = ''} = useParams();
  return <Navigate to={`/c/${companySlug}/app`} replace />;
}

/**
 * Tenant application child routes, mounted under `/c/:companySlug/app` in path
 * mode and under `/app` in host mode (subdomain or custom domain).
 */
function tenantAppChildRoutes() {
  return (
    <>
      <Route index element={<TenantOverviewPage />} />
      <Route path="definitions/branches" element={<BranchesPage />} />
      <Route path="definitions/geography" element={<GeographyPage />} />
      <Route path="definitions/services" element={<ServicesPage />} />
      <Route path="definitions/exceptions" element={<ExceptionsPage />} />
      <Route path="definitions/cashboxes" element={<CashboxesPage />} />
      <Route path="definitions/accounting-refs" element={<AccountingRefsPage />} />
      <Route path="clients" element={<ClientsListPage initialMode="list" />} />
      <Route path="clients/new" element={<ClientsListPage initialMode="create" />} />
      <Route path="clients/registrations" element={<ClientsListPage initialMode="registrations" />} />
      <Route path="clients/settlements" element={<ClientSettlementsPage />} />
      <Route path="clients/:clientId" element={<ClientDetailPage />} />
      <Route path="pricing/price-lists" element={<PriceListsPage />} />
      <Route path="pricing/price-lists/:priceListId" element={<PriceListDetailPage />} />
      <Route path="pricing/calculator" element={<PricingCalculatorPage />} />
      <Route path="security/users" element={<UsersManagementPage />} />
      <Route path="security/roles" element={<RolesPermissionsPage />} />
      <Route path="security/sessions" element={<SessionAuditPage />} />
      <Route path="security/integrations" element={<ApiIntegrationsPage />} />
      <Route path="couriers" element={<CouriersListPage initialMode="list" />} />
      <Route path="couriers/new" element={<CouriersListPage initialMode="create" />} />
      <Route path="couriers/commissions" element={<CommissionListsPage />} />
      <Route path="couriers/routes" element={<CourierRoutesPage />} />
      <Route path="couriers/settlements" element={<CourierSettlementsPage />} />
      <Route path="couriers/movements" element={<CourierMovementsPage />} />
      <Route path="shipments" element={<ShipmentsListPage preset="all" />} />
      <Route path="shipments/new" element={<CreateShipmentPage />} />
      <Route path="shipments/import" element={<ShipmentsImportPage />} />
      <Route path="shipments/warehouse" element={<ShipmentsListPage preset="warehouse" />} />
      <Route
        path="shipments/out-for-delivery"
        element={<ShipmentsListPage preset="out-for-delivery" />}
      />
      <Route path="shipments/rescheduled" element={<ShipmentsListPage preset="rescheduled" />} />
      <Route path="shipments/returns" element={<ShipmentsListPage preset="returns" />} />
      <Route path="shipments/tracking" element={<ShipmentsListPage preset="tracking" />} />
      <Route path="shipments/:shipmentId" element={<ShipmentDetailPage />} />
      <Route path="operations/pickup" element={<PickupListsPage />} />
      <Route path="operations/warehouse" element={<WarehouseIntakePage />} />
      <Route path="operations/transfers" element={<BranchTransfersPage />} />
      <Route path="operations/delivery" element={<DeliveryListsPage listType="delivery" />} />
      <Route path="operations/redelivery" element={<DeliveryListsPage listType="redelivery" />} />
      <Route path="operations/returns" element={<ReturnsWorkflowPage />} />
      <Route path="operations/courier-portal" element={<CourierPortalPage />} />
      <Route path="finance/cashboxes" element={<FinanceCashboxesPage />} />
      <Route path="finance/collections" element={<CourierCollectionsPage />} />
      <Route path="accounting/journal-entries" element={<JournalEntriesPage />} />
      <Route path="accounting/trial-balance" element={<TrialBalancePage />} />
      <Route path="reports" element={<ExecutiveReportsPage />} />
      <Route path="portal/dashboard" element={<ClientPortalDashboardPage />} />
      <Route path="portal/pickups" element={<ClientPortalPickupPage />} />
      <Route path="portal/finance" element={<ClientPortalFinancePage />} />
      <Route path="messaging" element={<MessagingCenterPage initialTab="messages" />} />
      <Route path="notifications" element={<MessagingCenterPage initialTab="notifications" />} />
      <Route path="settings" element={<TenantSettingsPage />} />
    </>
  );
}

/** Path-based routing: the platform apex, `/c/{slug}` fallback and the console. */
function PathModeRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeHubPage />} />
      <Route path="/platform/login" element={<PlatformLoginPage />} />
      <Route
        path="/platform"
        element={
          <RequirePlatformAdmin>
            <PlatformTenantsPage />
          </RequirePlatformAdmin>
        }
      />
      <Route path="/auth/set-password" element={<SetPasswordPage />} />
      <Route path="/c/:companySlug" element={<TenantPublicPage />} />
      <Route path="/c/:companySlug/portal" element={<ClientPortalEntryRedirect />} />
      <Route path="/c/:companySlug/track" element={<PublicTrackingPage />} />
      <Route path="/c/:companySlug/track/:token" element={<PublicTrackingPage />} />
      <Route path="/c/:companySlug/login" element={<TenantLoginPage />} />
      <Route
        path="/c/:companySlug/app"
        element={
          <RequireTenantMember>
            <TenantAdminShellPage />
          </RequireTenantMember>
        }
      >
        {tenantAppChildRoutes()}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Host-based routing: the tenant host is its own root (`/`, `/app`, `/login`). */
function HostModeRoutes() {
  return (
    <Routes>
      <Route path="/auth/set-password" element={<SetPasswordPage />} />
      <Route path="/" element={<TenantPublicPage />} />
      <Route path="/portal" element={<Navigate to="/app" replace />} />
      <Route path="/track" element={<PublicTrackingPage />} />
      <Route path="/track/:token" element={<PublicTrackingPage />} />
      <Route path="/login" element={<TenantLoginPage />} />
      <Route
        path="/app"
        element={
          <RequireTenantMember>
            <TenantAdminShellPage />
          </RequireTenantMember>
        }
      >
        {tenantAppChildRoutes()}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function AppRoutes() {
  return getActiveTenantSlug() ? <HostModeRoutes /> : <PathModeRoutes />;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <DirectionProvider>
        <AuthProvider>
          <TenantRuntimeProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </TenantRuntimeProvider>
        </AuthProvider>
      </DirectionProvider>
    </AppErrorBoundary>
  );
}
