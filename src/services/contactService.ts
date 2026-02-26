import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const identifyContact = async (
  email?: string,
  phoneNumber?: string
) => {
  // -----------------------------
  // STEP 0: Validate input
  // -----------------------------
  if (!email && !phoneNumber) {
    throw new Error("At least one of email or phoneNumber must be provided");
  }

  // -----------------------------
  // STEP 1: Build safe OR query
  // -----------------------------
  const conditions: any[] = [];
  if (email) conditions.push({ email });
  if (phoneNumber) conditions.push({ phoneNumber });

  const directMatches = await prisma.contact.findMany({
    where: {
      OR: conditions,
      deletedAt: null
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  // -----------------------------
  // STEP 2: No match → New primary
  // -----------------------------
  if (directMatches.length === 0) {
    const newPrimary = await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkPrecedence: "primary"
      }
    });

    return {
      primaryContactId: newPrimary.id,
      emails: email ? [email] : [],
      phoneNumbers: phoneNumber ? [phoneNumber] : [],
      secondaryContactIds: []
    };
  }

  // -----------------------------
  // STEP 3: Discover full identity graph
  // -----------------------------
  const visited = new Set<number>();
  let queue = directMatches.map((c) => c.id);

  while (queue.length > 0) {
    const found = await prisma.contact.findMany({
      where: {
        OR: [
          { id: { in: queue } },
          { linkedId: { in: queue } }
        ],
        deletedAt: null
      }
    });

    const newQueue: number[] = [];

    for (const contact of found) {
      if (!visited.has(contact.id)) {
        visited.add(contact.id);
        newQueue.push(contact.id);
      }
    }

    queue = newQueue;
  }

  const allContacts = await prisma.contact.findMany({
    where: {
      id: { in: Array.from(visited) }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  // -----------------------------
  // STEP 4: Oldest contact = primary
  // -----------------------------
  const primary = allContacts[0];

  // -----------------------------
  // STEP 5: Convert other primaries
  // -----------------------------
  for (const contact of allContacts) {
    if (
      contact.id !== primary.id &&
      contact.linkPrecedence === "primary"
    ) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          linkPrecedence: "secondary",
          linkedId: primary.id
        }
      });
    }
  }

  // -----------------------------
  // STEP 6: Check if new info introduced
  // -----------------------------
  const emailExists = email
    ? allContacts.some((c) => c.email === email)
    : true;

  const phoneExists = phoneNumber
    ? allContacts.some((c) => c.phoneNumber === phoneNumber)
    : true;

  if (!emailExists || !phoneExists) {
    await prisma.contact.create({
      data: {
        email,
        phoneNumber,
        linkedId: primary.id,
        linkPrecedence: "secondary"
      }
    });
  }

  // -----------------------------
  // STEP 7: Fetch final cluster
  // -----------------------------
  const finalContacts = await prisma.contact.findMany({
    where: {
      OR: [
        { id: primary.id },
        { linkedId: primary.id }
      ],
      deletedAt: null
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const emails = [
    ...new Set(finalContacts.map((c) => c.email).filter(Boolean))
  ];

  const phoneNumbersSet = [
    ...new Set(finalContacts.map((c) => c.phoneNumber).filter(Boolean))
  ];

  const secondaryIds = finalContacts
    .filter((c) => c.linkPrecedence === "secondary")
    .map((c) => c.id);

  return {
    primaryContactId: primary.id,
    emails,
    phoneNumbers: phoneNumbersSet,
    secondaryContactIds: secondaryIds
  };
};