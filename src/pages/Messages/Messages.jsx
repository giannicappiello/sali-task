import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  User,
  X,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import "./Messages.css";

function Messages() {
  const { profile } = useAuth();

  const [utenti, setUtenti] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [attachmentsByMessage, setAttachmentsByMessage] = useState({});

  const [selectedConversation, setSelectedConversation] = useState(null);
  const [search, setSearch] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");

  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  const bottomRef = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;
    loadInitialData();
  }, [profile?.id]);

  useEffect(() => {
    if (!selectedConversation?.id) return;

    loadMessages(selectedConversation.id);
    markConversationAsRead(selectedConversation.id);
    window.dispatchEvent(new CustomEvent("chat-read-updated"));

    const channel = supabase
      .channel(`chat-messages-${selectedConversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messaggi",
          filter: `conversazione_id=eq.${selectedConversation.id}`,
        },
        async () => {
          await loadMessages(selectedConversation.id);
          await loadConversations(false);
          await markConversationAsRead(selectedConversation.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadInitialData() {
    setLoading(true);
    await Promise.all([loadUsers(), loadConversations(true)]);
    setLoading(false);
  }

  async function loadUsers() {
    const { data, error } = await supabase
      .from("utenti")
      .select("id, nome, email, attivo, ruoli(nome), reparti(nome)")
      .eq("attivo", true)
      .order("nome");

    if (error) {
      console.error("Errore caricamento utenti:", error);
      setUtenti([]);
      return;
    }

    setUtenti((data || []).filter((utente) => utente.id !== profile?.id));
  }

  async function loadConversations(selectFirst = false) {
    if (!profile?.id) return;

    const { data: memberships, error } = await supabase
      .from("chat_partecipanti")
      .select(`
        id,
        ultimo_letto_il,
        conversazione_id,
        chat_conversazioni(
          id,
          titolo,
          tipo,
          created_at,
          updated_at,
          created_by
        )
      `)
      .eq("utente_id", profile.id);

    if (error) {
      console.error("Errore caricamento conversazioni:", error);
      setConversations([]);
      return;
    }

    const conversationIds = (memberships || []).map((membership) => membership.conversazione_id);

    if (conversationIds.length === 0) {
      setConversations([]);
      setSelectedConversation(null);
      return;
    }

    const [{ data: participants, error: participantsError }, { data: allMessages, error: messagesError }] =
      await Promise.all([
        supabase
          .from("chat_partecipanti")
          .select(`
            conversazione_id,
            utente_id,
            utenti(id, nome, email, avatar_url)
          `)
          .in("conversazione_id", conversationIds),
        supabase
          .from("chat_messaggi")
          .select(`
            id,
            conversazione_id,
            mittente_id,
            messaggio,
            created_at,
            utenti(nome)
          `)
          .in("conversazione_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

    if (participantsError) {
      console.error("Errore partecipanti chat:", participantsError);
    }

    if (messagesError) {
      console.error("Errore messaggi chat:", messagesError);
    }

    const mapped = (memberships || []).map((membership) => {
      const conversation = membership.chat_conversazioni;
      const convParticipants = (participants || []).filter(
        (participant) => participant.conversazione_id === conversation.id
      );

      const otherParticipants = convParticipants.filter(
        (participant) => participant.utente_id !== profile.id
      );

      const latestMessage = (allMessages || []).find(
        (message) => message.conversazione_id === conversation.id
      );

      const unreadCount = (allMessages || []).filter((message) => {
        if (message.conversazione_id !== conversation.id) return false;
        if (message.mittente_id === profile.id) return false;
        if (!membership.ultimo_letto_il) return true;
        return new Date(message.created_at) > new Date(membership.ultimo_letto_il);
      }).length;

      const title =
        conversation.titolo ||
        otherParticipants.map((participant) => participant.utenti?.nome).filter(Boolean).join(", ") ||
        "Conversazione";

      return {
        ...conversation,
        title,
        participants: convParticipants,
        otherParticipants,
        latestMessage,
        unreadCount,
        ultimo_letto_il: membership.ultimo_letto_il,
      };
    });

    mapped.sort((a, b) => {
      const aDate = new Date(a.latestMessage?.created_at || a.updated_at || a.created_at);
      const bDate = new Date(b.latestMessage?.created_at || b.updated_at || b.created_at);
      return bDate - aDate;
    });

    setConversations(mapped);

    if (selectFirst && mapped.length > 0 && !selectedConversation) {
      setSelectedConversation(mapped[0]);
    } else if (selectedConversation) {
      const refreshedSelected = mapped.find((item) => item.id === selectedConversation.id);
      if (refreshedSelected) {
        setSelectedConversation(refreshedSelected);
      }
    }
  }

  async function loadMessages(conversationId) {
    setMessagesLoading(true);

    const { data, error } = await supabase
      .from("chat_messaggi")
      .select(`
        id,
        conversazione_id,
        mittente_id,
        messaggio,
        created_at,
        utenti(nome, avatar_url)
      `)
      .eq("conversazione_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Errore caricamento messaggi:", error);
      setMessages([]);
      setAttachmentsByMessage({});
      setMessagesLoading(false);
      return;
    }

    const { data: attachments, error: attachmentsError } = await supabase
      .from("chat_allegati")
      .select("id,conversazione_id,messaggio_id,nome_file,file_url,storage_path,tipo_file,dimensione_bytes,created_at")
      .eq("conversazione_id", conversationId)
      .order("created_at", { ascending: true });

    if (attachmentsError) {
      console.error("Errore caricamento allegati chat:", attachmentsError);
      setAttachmentsByMessage({});
    } else {
      const grouped = {};
      (attachments || []).forEach((attachment) => {
        const key = attachment.messaggio_id;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(attachment);
      });
      setAttachmentsByMessage(grouped);
    }

    setMessages(data || []);
    setMessagesLoading(false);
  }

  async function markConversationAsRead(conversationId) {
  const { error } = await supabase.rpc("chat_mark_read", {
    p_conversazione_id: conversationId,
  });

  if (error) {
    console.error("Errore mark read chat:", error);
    return;
  }

  window.dispatchEvent(new CustomEvent("chat-read-updated"));
}

async function refreshChat() {
  await loadUsers();
  await loadConversations(false);

  if (selectedConversation?.id) {
    await loadMessages(selectedConversation.id);
    await markConversationAsRead(selectedConversation.id);
  }
}

  async function createConversation(e) {
    e.preventDefault();

    if (!selectedUserId) {
      alert("Seleziona un destinatario.");
      return;
    }

    setCreatingChat(true);

    const { data: conversationId, error } = await supabase.rpc("chat_create_direct", {
      p_other_user_id: selectedUserId,
    });

    setCreatingChat(false);

    if (error) {
      console.error("Errore creazione chat:", error);
      alert(`Errore durante la creazione della chat: ${error.message}`);
      return;
    }

    setNewChatOpen(false);
    setSelectedUserId("");

    await loadConversations(false);

    const { data: memberships } = await supabase
      .from("chat_partecipanti")
      .select(`
        id,
        ultimo_letto_il,
        conversazione_id,
        chat_conversazioni(
          id,
          titolo,
          tipo,
          created_at,
          updated_at,
          created_by
        )
      `)
      .eq("utente_id", profile.id)
      .eq("conversazione_id", conversationId)
      .maybeSingle();

    if (memberships?.chat_conversazioni) {
      const otherUser = utenti.find((utente) => utente.id === selectedUserId);
      setSelectedConversation({
        ...memberships.chat_conversazioni,
        title: otherUser?.nome || "Conversazione",
        participants: [],
        otherParticipants: [],
        latestMessage: null,
        unreadCount: 0,
      });
    }
  }

  function addPendingFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    setPendingFiles((current) => [...current, ...list]);
  }

  function removePendingFile(index) {
    setPendingFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function attachmentUrl(attachment) {
    if (attachment?.file_url) return attachment.file_url;
    if (!attachment?.storage_path) return "#";
    const { data } = supabase.storage.from("allegati").getPublicUrl(attachment.storage_path);
    return data?.publicUrl || "#";
  }

  async function uploadMessageAttachments(messageId, files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;

    for (const file of list) {
      const cleanFileName = file.name.replaceAll("/", "-");
      const storagePath = `${profile.id}/chat/${selectedConversation.id}/${messageId}/${Date.now()}-${cleanFileName}`;

      const uploaded = await supabase.storage.from("allegati").upload(storagePath, file, { upsert: true });
      if (uploaded.error) throw uploaded.error;

      const { data: publicUrlData } = supabase.storage.from("allegati").getPublicUrl(storagePath);
      const { error } = await supabase.from("chat_allegati").insert({
        conversazione_id: selectedConversation.id,
        messaggio_id: messageId,
        nome_file: file.name,
        file_url: publicUrlData?.publicUrl || null,
        storage_path: storagePath,
        tipo_file: file.type || null,
        dimensione_bytes: file.size || null,
        caricato_da_id: profile.id,
      });

      if (error) throw error;
    }
  }

  async function createMessageRecord(messageText) {
    const payload = {
      conversazione_id: selectedConversation.id,
      mittente_id: profile.id,
      messaggio: messageText,
    };

    const inserted = await supabase
      .from("chat_messaggi")
      .insert(payload)
      .select("id")
      .single();

    if (!inserted.error && inserted.data?.id) {
      await supabase
        .from("chat_conversazioni")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", selectedConversation.id);
      return inserted.data.id;
    }

    const rpcResult = await supabase.rpc("chat_send_message", {
      p_conversazione_id: selectedConversation.id,
      p_messaggio: messageText,
    });

    if (rpcResult.error) throw rpcResult.error;

    const latest = await supabase
      .from("chat_messaggi")
      .select("id")
      .eq("conversazione_id", selectedConversation.id)
      .eq("mittente_id", profile.id)
      .eq("messaggio", messageText)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest.error) throw latest.error;
    if (!latest.data?.id) throw new Error("Messaggio creato, ma non è stato possibile collegare gli allegati.");
    return latest.data.id;
  }

  async function sendMessage(e) {
    e.preventDefault();

    if (!selectedConversation?.id) return;
    if (!newMessage.trim() && pendingFiles.length === 0) return;

    setSending(true);

    const messageText = newMessage.trim() || "📎 Allegato";

    try {
      const messageId = await createMessageRecord(messageText);
      await uploadMessageAttachments(messageId, pendingFiles);

      setNewMessage("");
      setPendingFiles([]);
      await Promise.all([
        loadMessages(selectedConversation.id),
        loadConversations(false),
        markConversationAsRead(selectedConversation.id),
      ]);
    } catch (error) {
      console.error("Errore invio messaggio:", error);
      alert(`Errore durante l'invio del messaggio: ${error.message}`);
    } finally {
      setSending(false);
    }
  }

  function formatTime(date) {
    if (!date) return "";

    return new Date(date).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getInitials(name) {
    if (!name) return "U";

    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return conversations;

    return conversations.filter((conversation) => {
      const text = `
        ${conversation.title || ""}
        ${conversation.latestMessage?.messaggio || ""}
        ${conversation.otherParticipants.map((participant) => participant.utenti?.nome || "").join(" ")}
      `.toLowerCase();

      return text.includes(query);
    });
  }, [conversations, search]);

  const selectedTitle = selectedConversation?.title || "Seleziona una chat";

  return (
    <div className="messages-page">
      <div className="page-title-row">
        <div>
          <h1>Messaggi</h1>
          <p>Chat diretta tra utenti del workspace.</p>
        </div>

        <div className="messages-title-actions">
          <button className="secondary-action" onClick={refreshChat}>
            <RefreshCw size={18} />
            Aggiorna
          </button>

          <button className="primary-action" onClick={() => setNewChatOpen(true)}>
            <Plus size={18} />
            Nuova chat
          </button>
        </div>
      </div>

      <div className="messages-layout">
        <aside className="messages-sidebar panel">
          <div className="messages-search">
            <Search size={18} />
            <input
              placeholder="Cerca chat..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="conversation-list">
            {loading ? (
              <p className="messages-empty">Caricamento chat...</p>
            ) : filteredConversations.length === 0 ? (
              <p className="messages-empty">Nessuna chat presente.</p>
            ) : (
              filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`conversation-row ${
                    selectedConversation?.id === conversation.id ? "active" : ""
                  }`}
                  onClick={() => setSelectedConversation(conversation)}
                >
                  <div className="conversation-avatar">
                    {getInitials(conversation.title)}
                  </div>

                  <div>
                    <strong>{conversation.title}</strong>
                    <span>
                      {conversation.latestMessage?.messaggio || "Nessun messaggio"}
                    </span>
                  </div>

                  {conversation.unreadCount > 0 && (
                    <small>{conversation.unreadCount}</small>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="messages-chat panel">
          {selectedConversation ? (
            <>
              <div className="chat-header">
                <div className="conversation-avatar">
                  {getInitials(selectedTitle)}
                </div>

                <div>
                  <h3>{selectedTitle}</h3>
                  <p>
                    {selectedConversation.otherParticipants
                      ?.map((participant) => participant.utenti?.email)
                      .filter(Boolean)
                      .join(", ") || "Conversazione diretta"}
                  </p>
                </div>
              </div>

              <div className="chat-body">
                {messagesLoading ? (
                  <p className="messages-empty">Caricamento messaggi...</p>
                ) : messages.length === 0 ? (
                  <div className="chat-empty">
                    <MessageCircle size={38} />
                    <h4>Nessun messaggio</h4>
                    <p>Scrivi il primo messaggio per iniziare la conversazione.</p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const mine = message.mittente_id === profile?.id;

                    return (
                      <div
                        key={message.id}
                        className={`chat-message ${mine ? "mine" : "theirs"}`}
                      >
                        {!mine && (
                          <div className="chat-message-avatar">
                            {getInitials(message.utenti?.nome)}
                          </div>
                        )}

                        <div className="chat-bubble">
                          <strong>{mine ? "Tu" : message.utenti?.nome || "Utente"}</strong>
                          <p>{message.messaggio}</p>
                          {(attachmentsByMessage[message.id] || []).length > 0 && (
                            <div className="chat-attachments">
                              {(attachmentsByMessage[message.id] || []).map((attachment) => (
                                <a key={attachment.id} href={attachmentUrl(attachment)} target="_blank" rel="noreferrer" download={attachment.nome_file}>
                                  <Download size={15} />
                                  <span>{attachment.nome_file}</span>
                                  <em>{formatFileSize(attachment.dimensione_bytes)}</em>
                                </a>
                              ))}
                            </div>
                          )}
                          <span>{formatTime(message.created_at)}</span>
                        </div>
                      </div>
                    );
                  })
                )}

                <div ref={bottomRef} />
              </div>

              <form className="chat-compose" onSubmit={sendMessage}>
                {pendingFiles.length > 0 && (
                  <div className="chat-pending-files">
                    {pendingFiles.map((file, index) => (
                      <span key={`${file.name}-${index}`}>
                        <Paperclip size={14} />
                        {file.name}
                        <button type="button" onClick={() => removePendingFile(index)} title="Rimuovi allegato">
                          <Trash2 size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <label className="chat-attach-button" title="Aggiungi allegato">
                  <Paperclip size={18} />
                  <input type="file" multiple hidden onChange={(e) => { addPendingFiles(e.target.files); e.target.value = ""; }} />
                </label>

                <input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={`Scrivi a ${selectedTitle}...`}
                />
                <button className="primary-action" disabled={sending || (!newMessage.trim() && pendingFiles.length === 0)}>
                  <Send size={18} />
                  {sending ? "Invio..." : "Invia"}
                </button>
              </form>
            </>
          ) : (
            <div className="chat-empty whole">
              <MessageCircle size={42} />
              <h4>Seleziona una conversazione</h4>
              <p>Oppure crea una nuova chat con un utente.</p>
            </div>
          )}
        </section>
      </div>

      {newChatOpen && (
        <div className="modal-backdrop">
          <div className="new-chat-modal">
            <div className="modal-header">
              <div>
                <h2>Nuova chat</h2>
                <p>Seleziona una persona a cui inviare un messaggio.</p>
              </div>

              <button className="modal-close" onClick={() => setNewChatOpen(false)} type="button">
                <X size={22} />
              </button>
            </div>

            <form className="new-chat-form" onSubmit={createConversation}>
              <div className="form-group full">
                <label>Invia messaggio a</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  <option value="">Seleziona utente</option>
                  {utenti.map((utente) => (
                    <option key={utente.id} value={utente.id}>
                      {utente.nome} - {utente.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setNewChatOpen(false)}
                >
                  Annulla
                </button>

                <button className="primary-action" disabled={creatingChat}>
                  <User size={18} />
                  {creatingChat ? "Creazione..." : "Crea chat"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Messages;
