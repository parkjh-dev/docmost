import {
  Button,
  Divider,
  FileButton,
  Group,
  Modal,
  Text,
} from "@mantine/core";
import { useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { IconCheck, IconUpload, IconX } from "@tabler/icons-react";
import { importGroupsCsv } from "@/features/group/services/group-service";

interface GroupsCsvImportModalProps {
  opened: boolean;
  onClose: () => void;
}

export default function GroupsCsvImportModal({
  opened,
  onClose,
}: GroupsCsvImportModalProps) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const resetRef = useRef<() => void>(null);

  const handleFileSelect = (file: File | null) => {
    setSelectedFile(file);
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setIsImporting(true);
    handleClose();

    notifications.show({
      id: "csv-import-groups",
      title: t("Importing groups"),
      message: t("CSV import is in progress. Please do not close this tab."),
      loading: true,
      withCloseButton: false,
      autoClose: false,
    });

    try {
      const result = await importGroupsCsv(selectedFile);

      notifications.update({
        id: "csv-import-groups",
        color: "teal",
        title: t("Import complete"),
        message: t(
          "Created: {{created}}, Updated: {{updated}}, Failed: {{failed}}",
          {
            created: result.created ?? 0,
            updated: result.updated ?? 0,
            failed: result.failed ?? 0,
          },
        ),
        icon: <IconCheck size={18} />,
        loading: false,
        withCloseButton: true,
        autoClose: 8000,
      });
    } catch (err) {
      notifications.update({
        id: "csv-import-groups",
        color: "red",
        title: t("Import failed"),
        message: err.response?.data?.message || err.message,
        icon: <IconX size={18} />,
        loading: false,
        withCloseButton: true,
        autoClose: false,
      });
    } finally {
      setIsImporting(false);
      setSelectedFile(null);
      if (resetRef.current) resetRef.current();
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    if (resetRef.current) resetRef.current();
    onClose();
  };

  return (
    <Modal.Root
      opened={opened}
      onClose={handleClose}
      size={450}
      padding="xl"
      yOffset="10vh"
      xOffset={0}
    >
      <Modal.Overlay />
      <Modal.Content style={{ overflow: "hidden" }}>
        <Modal.Header py={0}>
          <Modal.Title fw={500}>{t("Import groups")}</Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <Text size="sm" c="dimmed" mb="md">
            {t(
              "Upload a CSV file with columns: name, description, members",
            )}
          </Text>

          <Group justify="center" mb="md">
            <FileButton
              onChange={handleFileSelect}
              accept=".csv"
              resetRef={resetRef}
            >
              {(props) => (
                <Button
                  variant="default"
                  leftSection={<IconUpload size={16} />}
                  {...props}
                >
                  {selectedFile ? selectedFile.name : t("Select CSV file")}
                </Button>
              )}
            </FileButton>
          </Group>

          <Divider my="sm" />

          <Group justify="center" mt="md">
            <Button onClick={handleClose} variant="default">
              {t("Cancel")}
            </Button>
            <Button
              onClick={handleImport}
              loading={isImporting}
              disabled={!selectedFile}
            >
              {t("Import")}
            </Button>
          </Group>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
