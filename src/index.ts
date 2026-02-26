import express from "express";
import cors from "cors";
import identifyRouter from "./routes/identify";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/identify", identifyRouter);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});