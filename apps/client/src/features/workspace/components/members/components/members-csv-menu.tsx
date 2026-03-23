import { Button, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown,
  IconDownload,
  IconFileTypeCsv,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { exportMembersCsv } from "@/features/workspace/services/workspace-service";
import MembersCsvImportModal from "./members-csv-import-modal";

export default function MembersCsvMenu() {
  const { t } = useTranslation();
  const [importOpened, { open: openImport, close: closeImport }] =
    useDisclosure(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportMembersCsv({ includeGroups: true });
      notifications.show({ message: t("Export successful") });
    } catch (err) {
      notifications.show({
        message:
          t("Export failed") +
          ": " +
          (err.response?.data?.message || err.message),
        color: "red",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <Menu shadow="md" width={200} position="bottom-end">
        <Menu.Target>
          <Button
            variant="default"
            rightSection={<IconChevronDown size={16} />}
            leftSection={<IconFileTypeCsv size={18} />}
          >
            CSV
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconUpload size={16} />}
            onClick={openImport}
          >
            {t("Import CSV")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconDownload size={16} />}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? t("Exporting...") : t("Export CSV")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <MembersCsvImportModal opened={importOpened} onClose={closeImport} />
    </>
  );
}
