import api from "@/lib/api-client";
import { IGroup } from "@/features/group/types/group.types";
import { IPagination, QueryParams } from "@/lib/types.ts";
import { IUser } from "@/features/user/types/user.types.ts";
import { saveAs } from "file-saver";

export async function getGroups(
  params?: QueryParams,
): Promise<IPagination<IGroup>> {
  const req = await api.post("/groups", params);
  return req.data;
}

export async function getGroupById(groupId: string): Promise<IGroup> {
  const req = await api.post<IGroup>("/groups/info", { groupId });
  return req.data as IGroup;
}

export async function createGroup(data: Partial<IGroup>): Promise<IGroup> {
  const req = await api.post<IGroup>("/groups/create", data);
  return req.data;
}

export async function updateGroup(data: Partial<IGroup>): Promise<IGroup> {
  const req = await api.post<IGroup>("/groups/update", data);
  return req.data;
}

export async function deleteGroup(data: { groupId: string }): Promise<void> {
  await api.post("/groups/delete", data);
}

export async function getGroupMembers(
  groupId: string,
  params?: QueryParams,
): Promise<IPagination<IUser>> {
  const req = await api.post("/groups/members", { groupId, ...params });
  return req.data;
}

export async function addGroupMember(data: {
  groupId: string;
  userIds: string[];
}): Promise<void> {
  await api.post("/groups/members/add", data);
}

export async function removeGroupMember(data: {
  groupId: string;
  userId: string;
}): Promise<void> {
  await api.post("/groups/members/remove", data);
}

export async function exportGroupsCsv(): Promise<void> {
  const req = await api.post("/groups/export", {}, {
    responseType: "blob",
  });

  const fileName = req?.headers["content-disposition"]
    ?.split("filename=")[1]
    ?.replace(/"/g, "");

  const decodedFileName = fileName
    ? decodeURIComponent(fileName)
    : "groups.csv";

  saveAs(req.data, decodedFileName);
}

export interface ICsvImportResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors?: Array<{ row: number; name?: string; reason: string }>;
}

export async function importGroupsCsv(
  file: File,
  stopOnError?: boolean,
): Promise<ICsvImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("stopOnError", String(stopOnError ?? false));

  const req = await api.post("/groups/import", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return req.data;
}
