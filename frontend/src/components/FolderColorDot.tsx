import type { FolderNode } from "../api/client";
import { getFolderTheme } from "../utils/folderColor";

export default function FolderColorDot({
  folderId,
  folders,
}: {
  folderId: number;
  folders?: FolderNode[];
}) {
  const theme = getFolderTheme(folderId, folders);
  return (
    <span
      className="folder-color-dot"
      style={{ backgroundColor: theme.dot }}
      aria-hidden
    />
  );
}
