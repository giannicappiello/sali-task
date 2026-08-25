import { Link, useLocation } from "react-router-dom";
import { crmCustomerPath } from "./crmCustomerIdentity";

export default function CrmCustomerLink({
  crmType,
  customerKey,
  customerCode,
  accountId,
  name,
  period,
  className = "crm-customer-link",
  children,
}) {
  const location = useLocation();
  const path = crmCustomerPath(crmType, { customerKey, customerCode, accountId });
  if (!path) return children || name || "Cliente non disponibile";
  const to = period ? period.withPeriod(path) : `${path}${location.search || ""}`;
  return (
    <Link
      className={className}
      to={to}
      state={{ from: `${location.pathname}${location.search}` }}
      aria-label={`Apri scheda cliente ${name || customerCode || accountId}`}
    >
      {children || name}
    </Link>
  );
}
