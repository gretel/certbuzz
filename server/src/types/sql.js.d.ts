declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): any[];
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayBuffer | Uint8Array) => Database;
  }

  export default function initSqlJs(): Promise<SqlJsStatic>;
}
