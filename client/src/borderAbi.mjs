// The slice of the token contract's ABI that verify-border reads, copied from
// warden/src/clock/abi.mjs. test/verify-border.test.mjs fails if they drift.
export const BORDER_ABI = [
  {
    "type": "function",
    "name": "viewOf",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "v",
        "type": "tuple",
        "internalType": "struct TokenView",
        "components": [
          {
            "name": "tokenId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "level",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "streak",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "lastDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "mintDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "generation",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "seedsGiven",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "parent",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "echo",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "resting",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "restDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "sunset",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "sunsetDay",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "fellRun",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "fellDay",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "marks",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "answers",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "agentKeyId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "code",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "today",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "answersOf",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256[2]",
        "internalType": "uint256[2]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "splitAnchorDay",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastRevealBlock",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "keyId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "code",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "day",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "firstAnswer",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "seed",
    "inputs": [
      {
        "name": "childId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "parentId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "code",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "day",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "expectedKeyId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "firstAnswer",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "batchCheckIn",
    "inputs": [
      {
        "name": "packedIds",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "days_",
        "type": "uint32[]",
        "internalType": "uint32[]"
      },
      {
        "name": "answerBits",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "record",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "checkInWithVoucher",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "day",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "wardenSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revealSplitKeys",
    "inputs": [
      {
        "name": "keys",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "questions",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "SplitKeysRevealed",
    "inputs": [
      {
        "name": "firstIndex",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "keys",
        "type": "bytes32[]",
        "indexed": false,
        "internalType": "bytes32[]"
      },
      {
        "name": "prevRevealBlock",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "questions",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Minted",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "keyId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Seeded",
    "inputs": [
      {
        "name": "parentId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "childId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "generation",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BatchCheckedIn",
    "inputs": [
      {
        "name": "fromDay",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "toDay",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "count",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MetadataUpdate",
    "inputs": [
      {
        "name": "_tokenId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
]
;
