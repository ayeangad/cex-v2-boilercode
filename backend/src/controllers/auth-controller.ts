import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { authSchema } from "../types/auth-schema.js";
import { createToken } from "../utils/auth.js";
import { sendValidationError } from "../utils/validation.js";

export async function signup(req: Request, res: Response): Promise<void> {
  const parsedBody = authSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const { username, password } = parsedBody.data;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    res.status(201).json({
      token: createToken({ userId: user.id }),
      userId: user.id,
      username: user.username,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server crash!" });
  }
}

export async function signin(req: Request, res: Response): Promise<void> {
  //TODO: Implement signin logic
  const parsedBody = authSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const { username, password } = parsedBody.data;

  try {
    const userExists = await prisma.user.findUnique({ where: { username } })
    if (!userExists) {
      res.status(403).json({
        message: "User doesn't exists!"
      });
      return;
    }

    const correctPassword = await bcrypt.compare(password, userExists.password)
    if (!correctPassword) {
      res.status(403).json({
        message: "Incorrect password!"
      })
      return;
    }

    const token = createToken({
      userId: userExists.id
    })

    res.json({
      message: "You've signed in!",
      token
    })

  } catch {
    res.status(401).json({ error: "Invalid credentials" });
  }
}
