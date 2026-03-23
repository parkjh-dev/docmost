import {
  Button,
  Checkbox,
  Divider,
  FileButton,
  Group,
  Modal,
  Text,
} from "@mantine/core";
import { useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { IconCheck, IconDownload, IconUpload, IconX } from "@tabler/icons-react";
import { importMembersCsv } from "@/features/workspace/services/workspace-service";
import { queryClient } from "@/main.tsx";

interface MembersCsvImportModalProps {
  opened: boolean;
  onClose: () => void;
}

export default function MembersCsvImportModal({
  opened,
  onClose,
}: MembersCsvImportModalProps) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stopOnError, setStopOnError] = useState<boolean>(false);
  const [deactivateNotInCsv, setDeactivateNotInCsv] = useState<boolean>(false);
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
      id: "csv-import-members",
      title: t("Importing members"),
      message: t("CSV import is in progress. Please do not close this tab."),
      loading: true,
      withCloseButton: false,
      autoClose: false,
    });

    try {
      const result = await importMembersCsv(selectedFile, { stopOnError, deactivateNotInCsv });

      notifications.update({
        id: "csv-import-members",
        color: "teal",
        title: t("Import complete"),
        message: t(
          "Created: {{created}}, Updated: {{updated}}, Deactivated: {{deactivated}}, Failed: {{failed}}",
          {
            created: result.created ?? 0,
            updated: result.updated ?? 0,
            deactivated: result.deactivated ?? 0,
            failed: result.failed ?? 0,
          },
        ),
        icon: <IconCheck size={18} />,
        loading: false,
        withCloseButton: true,
        autoClose: 8000,
      });

      await queryClient.invalidateQueries({ queryKey: ["workspaceMembers"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (err) {
      notifications.update({
        id: "csv-import-members",
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
      setStopOnError(false);
      setDeactivateNotInCsv(false);
      if (resetRef.current) resetRef.current();
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setStopOnError(false);
    setDeactivateNotInCsv(false);
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
          <Modal.Title fw={500}>{t("Import members")}</Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <Text size="sm" c="dimmed" mb="md">
            {t("Upload a CSV file with columns: email, name, role, groups")}
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

          <Group justify="center" mb="md">
            <Button
              component="a"
              href="/templates/users-import-template.csv"
              download="users-import-template.csv"
              variant="subtle"
              size="xs"
              leftSection={<IconDownload size={14} />}
            >
              {t("Download template")}
            </Button>
          </Group>

          <Checkbox
            label={t("Stop on error (rollback all on failure)")}
            checked={stopOnError}
            onChange={(event) => setStopOnError(event.currentTarget.checked)}
            mb="xs"
          />

          <Checkbox
            label={t("Deactivate members not in CSV")}
            checked={deactivateNotInCsv}
            onChange={(event) => setDeactivateNotInCsv(event.currentTarget.checked)}
            mb="md"
          />

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
