import { MongoMemoryServer } from "mongodb-memory-server";

let mongod: MongoMemoryServer | undefined;

export async function setup() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pdflinker_test");
}

export async function teardown() {
  await mongod?.stop();
}
