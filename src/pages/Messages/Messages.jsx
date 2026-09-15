import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { clearConversationPushNotifications, dispatchMessagePush } from "../../lib/pushNotifications";
import { useAuth } from "../../contexts/AuthContext";
import { useSearchParams } from "react-router-dom";
import ChatDirectory from "./ChatDirectory.jsx";
import { canSelectChatUser, chatUserName } from "./chatDirectory.js";
import "./Messages.css";

function Messages() {
  const { profile, isAdmin, canUseModule } = useAuth();
  const adminMode = Boolean(isAdmin?.());
  // L'invio personale è una funzione di base del Workspace per ogni utente autenticato.
  const canWriteMessages = Boolean(profile?.id);
  const canManageMessages = canUseModule("messaggi", "amministrazione");
  const [searchParams, setSearchParams] = useSearchParams();

  const [utenti, setUtenti] = useState([]);
  const [reparti, setReparti] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [attachmentsByMessage, setAttachmentsByMessage] = useState({});

  const [selectedConversation, setSelectedConversation] = useState(null);
  const [search, setSearch] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);

  const [directoryTab, setDirectoryTab] = useState("organization");
  const [selectingPeople, setSelectingPeople] = useState(false);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [chatError, setChatError] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(() => Boolean(searchParams.get("conversation")));
  const [allowedConversationIds, setAllowedConversationIds] = useState([]);

  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  const bottomRef = useRef(null);
  const messageRequestRef = useRef(0);
  const creationRef = useRef(false);
  const directoryUsersRef = useRef([]);
  const realtimeRefreshRef = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;
    loadInitialData();
  }, [profile?.id, adminMode]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const refreshFromRealtime = (change) => {
      window.clearTimeout(realtimeRefreshRef.current);
      realtimeRefreshRef.current = window.setTimeout(async () => {
        await loadConversations(false);
        const conversationId = change?.new?.conversazione_id || change?.old?.conversazione_id;
        if (conversationId && selectedConversation?.id === conversationId) {
          await loadMessages(conversationId);
          if (change.eventType === "INSERT" && change.new?.mittente_id !== profile.id) {
            await markConversationAsRead(conversationId);
          }
        }
      }, 80);
    };
    const channel = supabase
      .channel(`chat-workspace-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messaggi" }, refreshFromRealtime)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversazioni" }, refreshFromRealtime)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_partecipanti" }, refreshFromRealtime)
      .subscribe();
    return () => {
      window.clearTimeout(realtimeRefreshRef.current);
      supabase.removeChannel(channel);
    };
  }, [profile?.id, selectedConversation?.id]);

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
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_partecipanti",
          filter: `conversazione_id=eq.${selectedConversation.id}`,
        },
        (change) => {
          setSelectedConversation((current) => {
            if (!current || current.id !== selectedConversation.id) return current;
            return {
              ...current,
              participants: (current.participants || []).map((participant) => (
                participant.utente_id === change.new.utente_id
                  ? { ...participant, ultimo_letto_il: change.new.ultimo_letto_il }
                  : participant
              )),
            };
          });
          loadConversations(false);
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
    await loadDirectory();
    await loadConversations(true);
    setLoading(false);
  }

  async function loadDirectory() {
    setDirectoryLoading(true);
    setDirectoryError("");
    const { data, error } = await supabase.rpc("chat_directory");
    if (error) {
      setDirectoryError("Impossible caricare persone e reparti. Riprova.");
      setUtenti([]);
      directoryUsersRef.current = [];
      setReparti([]);
    } else {
      setUtenti(data?.users || []);
      directoryUsersRef.current = data?.users || [];
      setReparti(data?.departments || []);
    }
    setDirectoryLoading(false);
  }

  async function loadConversations(selectFirst = false, preferredId = null) {
    if (!profile?.id) return;

    let memberships;

    if (adminMode) {
      const { data: allConversations, error: conversationsError } = await supabase
        .from("chat_conversazioni")
        .select("id,titolo,tipo,created_at,updated_at,created_by")
        .order("updated_at", { ascending: false });

      if (conversationsError) {
        console.error("Errore caricamento conversazioni admin:", conversationsError);
        setConversations([]);
        return;
      }

      const { data: ownMemberships, error: ownMembershipsError } = await supabase
        .from("chat_partecipanti")
        .select("id,ultimo_letto_il,conversazione_id")
        .eq("utente_id", profile.id);

      if (ownMembershipsError) {
        console.error("Errore caricamento letture admin:", ownMembershipsError);
      }

      const ownByConversation = new Map(
        (ownMemberships || []).map((row) => [row.conversazione_id, row])
      );

      memberships = (allConversations || []).map((conversation) => {
        const own = ownByConversation.get(conversation.id);
        return {
          id: own?.id || null,
          ultimo_letto_il: own?.ultimo_letto_il || null,
          conversazione_id: conversation.id,
          chat_conversazioni: conversation,
          admin_observer: !own,
        };
      });
    } else {
      const { data, error } = await supabase
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

      memberships = data || [];
    }

    const conversationIds = memberships.map((membership) => membership.conversazione_id).filter(Boolean);

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
            ultimo_letto_il,
            utenti(id, nome, cognome, email, avatar_url)
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
            utenti(nome,cognome)
          `)
          .in("conversazione_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

    if (participantsError) console.error("Errore partecipanti chat:", participantsError);
    if (messagesError) console.error("Errore messaggi chat:", messagesError);

    const mapped = memberships.map((membership) => {
      const conversation = membership.chat_conversazioni;
      const convParticipants = (participants || []).filter(
        (participant) => participant.conversazione_id === conversation.id
      ).map((participant) => ({ ...participant, utenti: participant.utenti || directoryUsersRef.current.find((user) => user.id === participant.utente_id) }));
      const otherParticipants = convParticipants.filter(
        (participant) => participant.utente_id !== profile.id
      );
      const latestMessage = (allMessages || []).find(
        (message) => message.conversazione_id === conversation.id
      );
      const unreadCount = membership.admin_observer
        ? 0
        : (allMessages || []).filter((message) => {
            if (message.conversazione_id !== conversation.id) return false;
            if (message.mittente_id === profile.id) return false;
            if (!membership.ultimo_letto_il) return true;
            return new Date(message.created_at) > new Date(membership.ultimo_letto_il);
          }).length;
      const title =
        conversation.titolo ||
        otherParticipants.map((participant) => `${participant.utenti?.nome || ""} ${participant.utenti?.cognome || ""}`.trim()).filter(Boolean).join(", ") ||
        "Conversazione";

      return {
        ...conversation,
        title,
        participants: convParticipants,
        otherParticipants,
        latestMessage,
        unreadCount,
        ultimo_letto_il: membership.ultimo_letto_il,
        adminObserver: Boolean(membership.admin_observer),
      };
    });

    mapped.sort((a, b) => {
      const aDate = new Date(a.latestMessage?.created_at || a.updated_at || a.created_at);
      const bDate = new Date(b.latestMessage?.created_at || b.updated_at || b.created_at);
      return bDate - aDate;
    });

    const { data: allowedIds, error: permissionError } = await supabase.rpc("chat_writable_conversations", { p_ids: conversationIds });
    setAllowedConversationIds(permissionError ? [] : (allowedIds || []));
    setConversations(mapped);
    const requestedConversationId = preferredId || searchParams.get("conversation");
    const requestedConversation = requestedConversationId
      ? mapped.find((item) => item.id === requestedConversationId)
      : null;

    if (requestedConversation) {
      setSelectedConversation(requestedConversation);
    } else if (selectFirst && mapped.length > 0 && !selectedConversation && !window.matchMedia("(max-width: 760px)").matches) {
      setSelectedConversation(mapped[0]);
    } else if (selectedConversation) {
      const refreshedSelected = mapped.find((item) => item.id === selectedConversation.id);
      if (refreshedSelected) setSelectedConversation(refreshedSelected);
    }
  }

  async function loadMessages(conversationId) {
    const requestId = ++messageRequestRef.current;
    setMessagesLoading(true);

    const { data, error } = await supabase
      .from("chat_messaggi")
      .select(`
        id,
        conversazione_id,
        mittente_id,
        messaggio,
        created_at,
        utenti(nome, cognome, avatar_url)
      `)
      .eq("conversazione_id", conversationId)
      .order("created_at", { ascending: true });

    if (requestId !== messageRequestRef.current) return;
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

    if (requestId !== messageRequestRef.current) return;
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

  const { error: clearError } = await supabase.rpc("chat_clear_read_notifications", {
    p_conversazione_id: conversationId,
  });
  if (clearError) console.error("Errore pulizia notifiche chat:", clearError);
  await clearConversationPushNotifications(conversationId);
  window.dispatchEvent(new CustomEvent("chat-read-updated"));
  window.dispatchEvent(new CustomEvent("workspace:notifications-changed"));
}

  async function refreshChat() {
  await loadDirectory();
  await loadConversations(false);

  if (selectedConversation?.id) {
    await loadMessages(selectedConversation.id);
    await markConversationAsRead(selectedConversation.id);
  }
}

  async function deleteConversation() {
    if (!selectedConversation?.id) return;
    const confirmed = await window.workspaceConfirm(`Eliminare definitivamente la chat con ${selectedTitle}? Verranno eliminati anche messaggi e allegati.`);
    if (!confirmed) return;
    const conversationId = selectedConversation.id;
    const { error } = await supabase.rpc("chat_elimina_conversazione", {
      p_conversazione_id: conversationId,
    });
    if (error) {
      await window.workspaceAlert(error.message || "Impossibile eliminare la chat.");
      return;
    }
    setSelectedConversation(null);
    setMobileChatOpen(false);
    setMessages([]);
    setAttachmentsByMessage({});
    setSearchParams({});
    await loadConversations(false);
    window.dispatchEvent(new CustomEvent("workspace:notifications-changed"));
  }

  async function deleteMessage(message) {
    const confirmed = await window.workspaceConfirm("Eliminare definitivamente questo messaggio?");
    if (!confirmed) return;
    const { error } = await supabase.rpc("chat_elimina_messaggio", {
      p_messaggio_id: message.id,
    });
    if (error) {
      await window.workspaceAlert(error.message || "Impossibile eliminare il messaggio.");
      return;
    }
    setMessages((current) => current.filter((item) => item.id !== message.id));
    setAttachmentsByMessage((current) => {
      const next = { ...current };
      delete next[message.id];
      return next;
    });
    await loadConversations(false);
  }

  function selectChat(conversation) {
    if (conversation.id !== selectedConversation?.id) {
      setMessages([]);
      setNewMessage("");
      setPendingFiles([]);
    }
    setChatError("");
    setSelectedConversation(conversation);
    setSearchParams({ conversation: conversation.id });
    setMobileChatOpen(true);
  }

  async function createConversation(kind, target) {
    if (creationRef.current || sending || directoryLoading || directoryError) return;
    creationRef.current = true;
    setCreatingChat(true);
    setChatError("");
    try {
      const args = kind === "direct" ? { p_other_user_id: target.id }
        : kind === "department" ? { p_titolo: target.nome, p_reparto_ids: [target.id] }
        : { p_titolo: ("Gruppo · " + selectedPeople.map(chatUserName).join(", ")).slice(0, 120), p_user_ids: selectedPeopleIds };
      const rpc = kind === "direct" ? "chat_create_direct" : kind === "department" ? "chat_create_department_group" : "chat_create_people_group";
      const { data: id, error } = await supabase.rpc(rpc, args);
      if (error) throw error;
      const [{ data: conversation, error: conversationError }, { data: participants, error: participantError }] = await Promise.all([
        supabase.from("chat_conversazioni").select("id,titolo,tipo,created_at,updated_at,created_by").eq("id", id).single(),
        supabase.from("chat_partecipanti").select("conversazione_id,utente_id,ultimo_letto_il,utenti(id,nome,cognome,email)").eq("conversazione_id", id),
      ]);
      if (conversationError || participantError) throw conversationError || participantError;
      setAllowedConversationIds((current) => [...new Set([...current, id])]);
      selectChat({ ...conversation, title: conversation.titolo || chatUserName(target), participants: participants || [], otherParticipants: (participants || []).filter((p) => p.utente_id !== profile.id), unreadCount: 0 });
      setSelectingPeople(false);
      setSelectedPeopleIds([]);
      setDirectoryTab("chats");
      await loadConversations(false, id);
    } catch (error) {
      setChatError(error.message || "Impossibile aprire la conversazione. Riprova.");
    } finally {
      creationRef.current = false;
      setCreatingChat(false);
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

    if (!selectedConversation?.id || !canSendSelected || sending) return;
    if (!newMessage.trim() && pendingFiles.length === 0) return;

    setSending(true);

    const messageText = newMessage.trim() || "📎 Allegato";

    try {
      const messageId = await createMessageRecord(messageText);
      await uploadMessageAttachments(messageId, pendingFiles);
      dispatchMessagePush(messageId, selectedConversation.id)
        .catch((pushError) => console.error("Notifica push immediata non riuscita:", pushError));

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
        ${conversation.otherParticipants.map((participant) => `${participant.utenti?.nome || ""} ${participant.utenti?.cognome || ""}`.trim()).join(" ")}
      `.toLowerCase();

      return text.includes(query);
    });
  }, [conversations, search]);

  const directoryActor = utenti.find((user) => user.id === profile?.id);
  const selectedPeople = utenti.filter((user) => selectedPeopleIds.includes(user.id));
  const canSendSelected = canWriteMessages && allowedConversationIds.includes(selectedConversation?.id);

  function togglePerson(id) {
    const person = utenti.find((user) => user.id === id);
    if (!person) return;
    setSelectedPeopleIds((current) => current.includes(id) ? current.filter((item) => item !== id)
      : canSelectChatUser(directoryActor, person, utenti.filter((user) => current.includes(user.id))) ? [...current, id] : current);
  }

  const selectedTitle = selectedConversation?.title || "Seleziona una chat";
  const otherReadTimes = (selectedConversation?.participants || [])
    .filter((participant) => participant.utente_id !== profile?.id)
    .map((participant) => participant.ultimo_letto_il)
    .filter(Boolean);

  return (
    <div className={`messages-page${mobileChatOpen ? " mobile-chat-open" : ""}`}>
      <div className="messages-toolbar" aria-label="Azioni chat">
        <div className="messages-title-actions">
          <button className="secondary-action" onClick={refreshChat}>
            <RefreshCw size={18} />
            Aggiorna
          </button>

        </div>
      </div>
      {chatError && <div className="messages-error" role="alert">{chatError}</div>}

      <div className="messages-layout">
        <aside className="messages-sidebar panel">
          <div className="messages-tabs" role="tablist" aria-label="Persone e conversazioni">
            {[["chats", "Chat"], ["organization", "Organigramma"], ["department", "Il mio reparto"]].map(([id, label]) => <button key={id} id={"chat-tab-" + id} role="tab" type="button" aria-selected={directoryTab === id} aria-controls={"chat-panel-" + id} onClick={() => setDirectoryTab(id)}>{label}</button>)}
          </div>
          <div id={"chat-panel-" + directoryTab} role="tabpanel" aria-labelledby={"chat-tab-" + directoryTab} className="messages-sidebar-content">
          {directoryTab !== "chats" ? <ChatDirectory tab={directoryTab} users={utenti} departments={reparti} actor={directoryActor} selecting={selectingPeople} selectedIds={selectedPeopleIds} onToggleSelection={() => { setSelectingPeople(!selectingPeople); setSelectedPeopleIds([]); }} onToggleUser={togglePerson} onDirect={(user) => createConversation("direct", user)} onDepartment={(department) => createConversation("department", department)} onCreateGroup={() => createConversation("group")} busy={creatingChat || sending} loading={directoryLoading} error={directoryError} onRetry={loadDirectory} /> : <>

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
                  disabled={sending || creatingChat}
                  onClick={() => selectChat(conversation)}
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
          </>}
          </div>
        </aside>

        <section className="messages-chat panel">
          {selectingPeople && <div className="chat-selection" aria-live="polite"><span>{selectedPeopleIds.length} persone selezionate</span>{selectedPeopleIds.length >= 2 && <button type="button" className="primary-action" disabled={creatingChat || sending} onClick={() => createConversation("group")}>{creatingChat ? "Creazione..." : "Crea gruppo"}</button>}</div>}
          {selectedConversation ? (
            <>
              <div className="chat-header">
                <button type="button" className="chat-back" onClick={() => { setMobileChatOpen(false); setSearchParams({}); }}><ArrowLeft size={18} />Indietro</button>
                <div className="conversation-avatar">
                  {getInitials(selectedTitle)}
                </div>

                 <div className="chat-header-copy">
                   <h3>{selectedTitle}</h3>
                  <p>
                    {selectedConversation.tipo === "gruppo"
                      ? `${selectedConversation.participants?.length || 1} partecipanti`
                      : selectedConversation.otherParticipants
                          ?.map((participant) => participant.utenti?.email)
                          .filter(Boolean)
                          .join(", ") || "Conversazione diretta"}
                   </p>
                 </div>
                 {canManageMessages && <button type="button" className="chat-delete-action" onClick={deleteConversation} title="Elimina definitivamente la chat">
                   <Trash2 size={18} />
                   Elimina chat
                 </button>}
               </div>

              <div className="chat-body">
                {messagesLoading ? (
                  <p className="messages-empty">Caricamento messaggi...</p>
                ) : messages.length === 0 ? (
                  <div className="chat-empty">
                    <h4>La conversazione è pronta</h4>
                    <p>Scrivi il primo messaggio.</p>
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
                            {getInitials(`${message.utenti?.nome || ""} ${message.utenti?.cognome || ""}`.trim())}
                          </div>
                        )}

                        <div className="chat-bubble">
                          <strong>{mine ? "Tu" : `${message.utenti?.nome || ""} ${message.utenti?.cognome || ""}`.trim() || "Utente"}</strong>
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
                          <span className="chat-message-meta">
                            {formatTime(message.created_at)}
                            {mine && <span className={`chat-read-check${otherReadTimes.length && otherReadTimes.every((readAt) => new Date(readAt) >= new Date(message.created_at)) ? " read" : ""}`} title={otherReadTimes.length && otherReadTimes.every((readAt) => new Date(readAt) >= new Date(message.created_at)) ? "Letto" : "Consegnato"}>
                              {otherReadTimes.length && otherReadTimes.every((readAt) => new Date(readAt) >= new Date(message.created_at)) ? "✓✓" : "✓"}
                            </span>}
                            {canWriteMessages && (mine || canManageMessages) && <button type="button" className="chat-message-delete" onClick={() => deleteMessage(message)} title="Elimina definitivamente il messaggio">
                              <Trash2 size={13} />
                              Elimina
                            </button>}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}

                <div ref={bottomRef} />
              </div>

              {canSendSelected ? <form className="chat-compose" onSubmit={sendMessage}>
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
              </form> : <p className="messages-empty">Questa conversazione è in sola lettura: i partecipanti non rispettano le attuali regole di reparto.</p>}
            </>
          ) : (
            <div className="chat-empty whole">
              <MessageCircle size={42} />
              <h4>Seleziona una conversazione</h4>
              <p>Scegli una persona o un reparto dalle schede a sinistra.</p>
            </div>
          )}
        </section>
      </div>

    </div>
  );
}

export default Messages;
