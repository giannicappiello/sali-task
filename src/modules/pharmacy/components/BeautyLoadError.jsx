export default function BeautyLoadError({ message, onRetry }) {
  if (!message) return null;
  return (
    <div role="alert" className="panel" style={{ color: "#9f1239", background: "#fff1f2", marginBottom: 16 }}>
      <p>Impossibile caricare le attività Beauty Days. {message}</p>
      <button type="button" onClick={onRetry}>Riprova</button>
    </div>
  );
}
