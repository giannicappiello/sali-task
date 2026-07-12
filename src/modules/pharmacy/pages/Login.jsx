import { useState } from "react";
import { supabase } from "../services/reportSupabase";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    onLogin();
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h2>Accesso</h2>

        <form onSubmit={handleLogin} style={formStyle}>
          <input
            style={inputStyle}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            style={inputStyle}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button style={buttonStyle}>
            {loading ? "Accesso..." : "Accedi"}
          </button>
        </form>
      </div>
    </div>
  );
}

const containerStyle = {
  display: "flex",
  justifyContent: "center",
  marginTop: "100px",
};

const cardStyle = {
  width: "400px",
  padding: "30px",
  border: "1px solid #2D2B28",
  borderRadius: "20px",
  backgroundColor: "white",
};

const formStyle = {
  display: "grid",
  gap: "12px",
};

const inputStyle = {
  padding: "14px",
  borderRadius: "10px",
  border: "1px solid #ddd",
};

const buttonStyle = {
  padding: "14px",
  border: "none",
  backgroundColor: "#2D2B28",
  color: "white",
  borderRadius: "12px",
  cursor: "pointer",
};