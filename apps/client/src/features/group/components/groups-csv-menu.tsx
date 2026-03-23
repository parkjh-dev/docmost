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
import { exportGroupsCsv } from "@/features/group/services/group-service";
import GroupsCsvImportModal from "./groups-csv-import-modal";

export default function GroupsCsvMenu() {
  const { t } = useTranslation();
  const [importOpened, { open: openImport, close: closeImport }] =
    useDisclosure(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportGroupsCsv();
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
          <Menu.Divider />
          <Menu.Item
            component="a"
            href="/templates/groups-import-template.csv"
            download="groups-import-template.csv"
            leftSection={<IconFileTypeCsv size={16} />}
          >
            {t("Download template")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <GroupsCsvImportModal opened={importOpened} onClose={closeImport} />
    </>
  );
}
