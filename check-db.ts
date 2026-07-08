import { GetCommand } from "@aws-sdk/lib-dynamodb";
import ddb, { TABLE_NAME } from "./src/lib/db";

async function run() {
  const res = await ddb.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: 'CUSTOMER#29eca681-c2d0-4217-8222-af60dce54eb3',
      SK: 'PROFILE'
    }
  }));
  console.log(JSON.stringify(res.Item, null, 2));
}

run();
