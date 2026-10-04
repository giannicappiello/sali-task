export function gpsErrorMessage(error) {
  switch (error?.code) {
    case 1: return 'Permesso posizione negato. Consenti l’accesso alla posizione per Workspace.';
    case 2: return 'Posizione non disponibile. Verifica il GPS del dispositivo e riprova.';
    case 3: return 'Timeout durante la ricerca della posizione. Riprova.';
    default: return 'Impossibile acquisire la posizione. Riprova.';
  }
}
