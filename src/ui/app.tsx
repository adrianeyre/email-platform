import { useSyncExternalStore } from "react";
import { ApiRequestFailedError, readText } from "./api-client.js";
import { Layout } from "./layout.js";
import { AppearancePage } from "./page-appearance.js";
import { ApiKeysPage } from "./page-api-keys.js";
import {
  ConfigurationPage,
  ConfigurationsPage,
} from "./page-configurations.js";
import { LogsPage, MessagePage } from "./page-logs.js";
import { SettingsPage } from "./page-settings.js";
import { SignInPage } from "./page-sign-in.js";
import { TemplateEditorPage, TemplatesPage } from "./page-templates.js";
import { UsersPage } from "./page-users.js";
import {
  matchRoute,
  subscribeToNavigation,
  type RouteMatch,
  type RouteName,
} from "./router.js";
import { FailureNotice, LoadingState } from "./ui-parts.js";
import { useApiData } from "./use-api-data.js";

const readPathname = () => window.location.pathname;

const renderPage = (route: RouteMatch, userId: string) => {
  switch (route.name) {
    case "templates":
      return <TemplatesPage />;
    case "newTemplate":
      return <TemplateEditorPage templateId={undefined} />;
    case "template":
      return <TemplateEditorPage templateId={route.params.templateId} />;
    case "headers":
      return <TemplatesPage kind="header" />;
    case "newHeader":
      return <TemplateEditorPage templateId={undefined} kind="header" />;
    case "header":
      return (
        <TemplateEditorPage templateId={route.params.partId} kind="header" />
      );
    case "footers":
      return <TemplatesPage kind="footer" />;
    case "newFooter":
      return <TemplateEditorPage templateId={undefined} kind="footer" />;
    case "footer":
      return (
        <TemplateEditorPage templateId={route.params.partId} kind="footer" />
      );
    case "configurations":
      return <ConfigurationsPage />;
    case "newConfiguration":
      return <ConfigurationPage configurationId={undefined} />;
    case "configuration":
      return (
        <ConfigurationPage configurationId={route.params.configurationId} />
      );
    case "logs":
      return <LogsPage />;
    case "message":
      return <MessagePage messageId={route.params.messageId ?? ""} />;
    case "apiKeys":
      return <ApiKeysPage />;
    case "users":
      return <UsersPage currentUserId={userId} />;
    case "delivery":
      return <SettingsPage />;
    case "settings":
      return <AppearancePage />;
    case "notFound":
      return (
        <>
          <h1>Page not found</h1>
          <p>This page does not exist.</p>
        </>
      );
  }
};

const pageTitles: Record<RouteName, string> = {
  templates: "Templates",
  newTemplate: "New template",
  template: "Edit template",
  headers: "Headers",
  newHeader: "New header",
  header: "Edit header",
  footers: "Footers",
  newFooter: "New footer",
  footer: "Edit footer",
  configurations: "Configuration",
  newConfiguration: "New configuration",
  configuration: "Edit configuration",
  logs: "Logs",
  message: "Email",
  apiKeys: "API keys",
  users: "Users",
  delivery: "Delivery",
  settings: "Settings",
  notFound: "Page not found",
};

export const App = () => {
  const pathname = useSyncExternalStore(subscribeToNavigation, readPathname);
  const me = useApiData("/app/me");

  if (me.error instanceof ApiRequestFailedError && me.error.status === 401) {
    return <SignInPage onSignedIn={me.reload} />;
  }
  if (me.data === undefined) {
    return (
      <main id="main" className="loading-screen">
        <LoadingState isLoading={me.isLoading} />
        <FailureNotice error={me.error} />
      </main>
    );
  }
  const route = matchRoute(pathname);
  return (
    <Layout
      email={readText(me.data, "email")}
      pathname={pathname}
      title={pageTitles[route.name]}
    >
      {renderPage(route, readText(me.data, "userId"))}
    </Layout>
  );
};
