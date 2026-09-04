import { Link, useLocation } from "react-router-dom";

export function CrmPageHeader({ eyebrow = "CRM Workspace", title, description, actions = null, children = null }) {
  return (
    <header className="panel crm-panel crm-page-header">
      <div className="crm-page-header-row">
        <div className="crm-page-header-copy"><span className="crm-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
        {actions ? <div className="crm-toolbar-actions">{actions}</div> : null}
      </div>
      {children ? <div className="crm-page-navigation">{children}</div> : null}
    </header>
  );
}
export function CrmSectionNav({ items, period, label }) {
  const location = useLocation();
  const activePath = items
    .map(([, path]) => path)
    .filter((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
    .sort((left, right) => right.length - left.length)[0] || null;
  return (
    <nav className="crm-section-nav" aria-label={label}>
      {items.map(([itemLabel, path]) => {
        const active = path === activePath;
        return <Link key={path} className={active ? "active" : ""} aria-current={active ? "page" : undefined} to={period ? period.withPeriod(path) : path}>{itemLabel}</Link>;
      })}
    </nav>
  );
}
