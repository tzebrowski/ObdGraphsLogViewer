/** Ambient types for the Google Identity Services + GAPI globals loaded dynamically at runtime. */

export interface GapiToken {
  access_token: string;
  expires_at?: number;
  expires_in?: number;
}

export interface DriveUser {
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
}

export interface DriveApiFile {
  id: string;
  name: string;
  size?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

export interface DriveFilesListResponse {
  result: {
    files: DriveApiFile[];
    nextPageToken?: string;
  };
}

interface GapiFilesList {
  list(args: {
    q?: string;
    fields?: string;
    pageSize?: number;
    pageToken?: string | null;
    orderBy?: string;
  }): Promise<DriveFilesListResponse>;
  update(args: {
    fileId: string;
    appProperties: Record<string, string>;
  }): Promise<unknown>;
}

interface GapiPermissions {
  create(args: {
    fileId: string;
    resource: { role: string; type: string };
  }): Promise<unknown>;
}

interface GapiClient {
  init(args: { discoveryDocs: string[] }): Promise<void>;
  getToken(): GapiToken | null;
  setToken(token: GapiToken | null): void;
  drive: {
    about: {
      get(args: { fields: string }): Promise<{ result: { user: DriveUser } }>;
    };
    files: GapiFilesList;
    permissions: GapiPermissions;
  };
}

export interface Gapi {
  load(api: string, callback: () => void): void;
  client: GapiClient;
}

export interface GoogleTokenClient {
  requestAccessToken(args: { prompt: string }): void;
}

export interface GoogleAccountsOAuth2CallbackResponse {
  error?: string;
  access_token?: string;
  expires_in?: number;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient(args: {
      client_id: string;
      scope: string;
      callback: (resp: GoogleAccountsOAuth2CallbackResponse) => void;
    }): GoogleTokenClient;
  };
}

export interface GoogleGlobal {
  accounts: GoogleAccounts;
}

declare global {
  interface Window {
    gapi?: Gapi;
    google?: GoogleGlobal;
  }
}

export {};
