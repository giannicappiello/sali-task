import Documentation from "./Documentation";
import { MANUALS_SECTION_FOLDER } from "./documentSectionScope";

export default function ManualiUso() {
  return (
    <Documentation
      includeSectionFolder={MANUALS_SECTION_FOLDER}
      title="Manuali d'uso"
      description="Consulta manuali d'uso e guide operative."
      searchPlaceholder="Cerca nei manuali d'uso..."
    />
  );
}
