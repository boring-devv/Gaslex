"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import toast from "react-hot-toast";
import { useNetwork } from "@/contexts/NetworkContext";
import { WalletSendTransactionError } from "@solana/wallet-adapter-base";
import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFirestore, collection, addDoc, doc, updateDoc, arrayRemove, arrayUnion, getDocs } from "firebase/firestore";
// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyBBMHa0v3Z0AQy9EZJp043n_8-XeAr582c",
  authDomain: "bcs-website-assets.firebaseapp.com",
  databaseURL: "https://bcs-website-assets-default-rtdb.firebaseio.com",
  projectId: "bcs-website-assets",
  storageBucket: "bcs-website-assets.appspot.com",
  messagingSenderId: "1065298706004",
  appId: "1:1065298706004:web:cf5e5d578ae2d9af42b7c1",
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const storage = getStorage(firebaseApp);
const db = getFirestore(firebaseApp);

export function WalletDashboard() {
  const { publicKey, wallet, signTransaction } = useWallet();
  const { network } = useNetwork();

  const [balance, setBalance] = useState<number | null>(null);
  const [recipient, setRecipient] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [txHistory, setTxHistory] = useState<
    Array<{ hash: string; amount: string; date: Date }>
  >([]);
  const [ads, setAds] = useState<Array<{ id: string; link: string; [key: string]: any }>>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [adForm, setAdForm] = useState({
    title: "",
    description: "",
    link: "",
    type: "image", // Default to image
    content: null as File | null,
  });

  const connection = new Connection(network.endpoint);

  const fetchBalance = async () => {
    if (!publicKey) return;
    try {
      const balance = await connection.getBalance(publicKey);
      setBalance(balance / LAMPORTS_PER_SOL);
    } catch (e) {
      console.error("Error fetching balance:", e);
      toast.error("Failed to fetch balance");
    }
  };

  const fetchAds = async () => {
    try {
      const response = await fetch("https://gaslex-main.vercel.app/api/sponsor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "get-ads" }),
      });
      const data = await response.json();
      if (data.success) {
        setAds(data.ads);
      } else {
        toast.error("Failed to fetch ads");
      }
    } catch (error) {
      console.error("Error fetching ads:", error);
      toast.error("Failed to fetch ads");
    }
  };

  const handleAdClick = async (adId: string, adLink: string) => {
    if (!publicKey) {
      toast.error("Wallet not connected");
      return;
    }

    try {
      // Mark the user as engaged with the ad
      const engagementResponse = await fetch("https://gaslex-main.vercel.app/api/sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "engage-ad",
          userPubkey: publicKey.toString(),
          adId: adId,
        }),
      });

      const engagementData = await engagementResponse.json();

      if (!engagementData.success) {
        throw new Error("Failed to engage with ad");
      }

      // Redirect the user to the ad's link
      window.open(adLink, "_blank");
    } catch (error) {
      console.error("Error engaging with ad:", error);
      toast.error("Failed to engage with ad");
    }
  };

  const handleAdPayment = async () => {
    const fixedAmount = "0.1"; // Fixed amount for ad submission
    const fixedRecipient = "4WxHcApXLCLscq3JHkiNZpdvowu5oiiL9e5R4X8ZV6KE"; // Fixed recipient address
  
    if (!publicKey) {
      toast.error("Wallet not connected");
      return false;
    }
  
    const toastId = toast.loading("Processing payment...");
  
    try {
      setLoading(true);
  
      // Fetch the latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();
  
      // Create the transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(fixedRecipient),
          lamports: parseFloat(fixedAmount) * LAMPORTS_PER_SOL,
        })
      );
  
      // Set fee payer and recent blockhash
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = blockhash;
  
      // Sign and send the transaction
      if (!wallet?.adapter?.sendTransaction) {
        throw new Error("Wallet doesn't support sending transactions");
      }
  
      const signature = await wallet.adapter.sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature);
  
      // Show toast after gas fee is paid
      toast.success("Gas fee paid successfully!", { id: toastId });
  
      return true; // Payment successful
    } catch (error) {
      console.error("Payment failed:", error);
  
      if (error instanceof WalletSendTransactionError) {
        console.error("Transaction logs:", error);
      }
  
      toast.error("Payment failed. Please try again.", { id: toastId });
      return false; // Payment failed
    } finally {
      setLoading(false);
    }
  };

  const handleAdFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setAdForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAdForm((prev) => ({ ...prev, content: e.target.files![0] }));
    }
  };

  const handleAdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
  
    if (!publicKey) {
      toast.error("Wallet not connected");
      return;
    }
  
    // Step 1: Process payment
    const paymentSuccess = await handleAdPayment();
    if (!paymentSuccess) {
      return; // Stop if payment fails
    }
  
    // Step 2: Upload content to Firebase Storage (if applicable)
    let contentUrl = null;
    if (adForm.content && adForm.type !== "text") {
      try {
        const storageRef = ref(storage, `ads/${adForm.content.name}`);
        await uploadBytes(storageRef, adForm.content);
        contentUrl = await getDownloadURL(storageRef);
      } catch (error) {
        console.error("Error uploading file to Firebase:", error);
        toast.error("Failed to upload file");
        return;
      }
    }
  
    // Step 3: Save ad data to Firestore
    try {
      const adData = {
        title: adForm.title,
        description: adForm.description,
        link: adForm.link,
        type: adForm.type,
        contentUrl: contentUrl, // Firebase Storage URL
        engagedUsers: [], // Initialize with an empty array
        timestamp: new Date(), // Add a timestamp
      };
  
      // Add the ad to the "ads" collection in Firestore
      await addDoc(collection(db, "ads"), adData);
  
      toast.success("Ad submitted successfully!");
      setIsModalOpen(false);
      fetchAds(); // Refresh the ads list
    } catch (error) {
      console.error("Error saving ad to Firestore:", error);
      toast.error("Failed to submit ad");
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
  
    if (!publicKey || !recipient || !amount) {
      toast.error("Please fill in all fields");
      return;
    }
  
    const toastId = toast.loading("Preparing transaction...");
    let transaction: Transaction | undefined;
  
    try {
      setLoading(true);
  
      // Step 1: Check if the user has engaged with any ad
      const adsRef = collection(db, "ads");
      const adsSnapshot = await getDocs(adsRef);
  
      let hasEngaged = false;
      let adId = "";
  
      // Check if the user's wallet is in `engagedUsers`
      for (const doc of adsSnapshot.docs) {
        const adData = doc.data();
        if (adData.engagedUsers?.includes(publicKey.toString())) {
          hasEngaged = true;
          adId = doc.id; // Save the ad ID for later
          break; // Exit loop if engagement is found
        }
      }
  
      // If the user hasn't engaged with any ad, check if they are in `usedAds`
      if (!hasEngaged) {
        for (const doc of adsSnapshot.docs) {
          const adData = doc.data();
          if (adData.usedAds?.includes(publicKey.toString())) {
            throw new Error("You have already used this ad. Please engage with another ad.");
          }
        }
        throw new Error("You must engage with at least one ad to send SOL.");
      }
  
      // Step 2: Fetch the latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();
  
      // Step 3: Create the transaction
      transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(recipient),
          lamports: parseFloat(amount) * LAMPORTS_PER_SOL,
        })
      );
  
      // Step 4: Set fee payer and recent blockhash
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = blockhash;
  
      // Step 5: Sign and send the transaction
      if (!wallet?.adapter?.sendTransaction) {
        throw new Error("Wallet doesn't support sending transactions");
      }
  
      const signature = await wallet.adapter.sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature);


      toast.success("Gas fee paid successfully!", { id: toastId });
      // Step 6: Move the user's wallet from `engagedUsers` to `usedAds`
      const adDocRef = doc(db, "ads", adId);
      await updateDoc(adDocRef, {
        engagedUsers: arrayRemove(publicKey.toString()), // Remove from engagedUsers
        usedAds: arrayUnion(publicKey.toString()), // Add to usedAds
      });
  
      // Step 7: Show success toast
      toast.success(`${amount} SOL sent!`, { id: toastId });
  
      // Reset form
      setRecipient("");
      setAmount("");
    } catch (error) {
      console.error("Transaction failed:", error);
  
      if (error instanceof WalletSendTransactionError) {
        console.error("Transaction logs:", error);
      }
  
      const errorMessage = error instanceof Error ? error.message : "Transaction failed";
      toast.error(errorMessage, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (publicKey) {
      toast.success("Wallet connected!");
      fetchBalance();
      fetchAds();
      const interval = setInterval(fetchBalance, 30000);
      return () => clearInterval(interval);
    } else {
      setBalance(null);
    }
  }, [network, publicKey]);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-5xl font-bold mb-8 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 glitch-text">
        GasleX Wallet
        <span className="text-sm ml-2 font-normal bg-black/50 px-2 py-1 rounded-md border border-cyan-800/50">
          {network.label}
        </span>
      </h1>

      <div className="space-y-8">
        {!publicKey ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] border border-cyan-800 rounded-lg bg-black/50 backdrop-blur relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('/sonic-pattern.svg')] opacity-5"></div>
            <div className="relative z-10">
              <h2 className="text-2xl mb-4 text-cyan-400">
                Connect your wallet to go Gas Lex🚀🚀
              </h2>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-8 md:grid-cols-2">
              <div className="p-6 border border-cyan-800 rounded-lg bg-black/50 backdrop-blur relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('/sonic-pattern.svg')] opacity-5"></div>
                <div className="relative z-10">
                  <h2 className="text-xl mb-2 text-cyan-400">Your Balance</h2>
                  <div className="text-4xl font-mono mb-2">
                    {balance === null ? (
                      <span className="text-cyan-500">Loading...</span>
                    ) : (
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">
                        {balance.toFixed(4)} SOL
                      </span>
                    )}
                  </div>
                  <div className="mt-4 text-sm text-cyan-600 font-mono break-all bg-black/30 p-2 rounded">
                    {publicKey.toBase58()}
                  </div>
                </div>
              </div>

              <form
                onSubmit={handleSend}
                className="p-6 border border-cyan-800 rounded-lg bg-black/50 backdrop-blur relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-[url('/sonic-pattern.svg')] opacity-5"></div>
                <div className="relative z-10">
                  <h2 className="text-xl mb-4 text-cyan-400">Send SOL</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm mb-2 text-cyan-500">
                        Recipient Address
                      </label>
                      <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        className="w-full p-2 bg-black/50 border border-cyan-800 rounded text-cyan-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                        placeholder="Enter recipient's address"
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-2 text-cyan-500">
                        Amount (SOL)
                      </label>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full p-2 bg-black/50 border border-cyan-800 rounded text-cyan-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                        placeholder="0.0"
                        step="0.001"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 px-4 bg-gradient-to-r from-cyan-600 to-purple-600 text-white rounded hover:from-cyan-500 hover:to-purple-500 transition-all disabled:opacity-50 font-mono relative overflow-hidden group"
                    >
                      <span className="relative z-10">
                        {loading ? "Processing..." : "Send SOL"}
                      </span>
                      <span className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-purple-400 opacity-0 group-hover:opacity-20 transition-opacity"></span>
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Shill My Project Button */}
            <button
              onClick={() => setIsModalOpen(true)}
              className="w-full py-3 px-4 bg-gradient-to-r from-cyan-600 to-purple-600 text-white rounded hover:from-cyan-500 hover:to-purple-500 transition-all font-mono"
            >
              Shill my project on Gaslex
            </button>

            {/* Modal for Ad Submission */}
            {isModalOpen && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur flex items-center justify-center z-50">
                <div className="bg-black/70 p-6 rounded-lg border border-cyan-800/50 w-full max-w-md">
                  <h2 className="text-xl mb-4 text-cyan-400">Submit Your Ad</h2>
                  <form onSubmit={handleAdSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm mb-2 text-cyan-500">Title</label>
                      <input
                        type="text"
                        name="title"
                        value={adForm.title}
                        onChange={handleAdFormChange}
                        className="w-full p-2 bg-black/50 border border-cyan-800 rounded text-cyan-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-2 text-cyan-500">Description</label>
                      <textarea
                        name="description"
                        value={adForm.description}
                        onChange={handleAdFormChange}
                        className="w-full p-2 bg-black/50 border border-cyan-800 rounded text-cyan-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-2 text-cyan-500">Link</label>
                      <input
                        type="url"
                        name="link"
                        value={adForm.link}
                        onChange={handleAdFormChange}
                        className="w-full p-2 bg-black/50 border border-cyan-800 rounded text-cyan-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-2 text-cyan-500">Type</label>
                      <select
                        name="type"
                        value={adForm.type}
                        onChange={handleAdFormChange}
                        className="w-full p-2 bg-black/50 border border-cyan-800 rounded text-cyan-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                        required
                      >
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                        <option value="text">Text</option>
                      </select>
                    </div>
                    {adForm.type !== "text" && (
                      <div>
                        <label className="block text-sm mb-2 text-cyan-500">Content</label>
                        <input
                          type="file"
                          name="content"
                          onChange={handleFileChange}
                          className="w-full p-2 bg-black/50 border border-cyan-800 rounded text-cyan-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                          required={adForm.type !== "text"}
                        />
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsModalOpen(false)}
                        className="py-2 px-4 bg-gray-600 text-white rounded hover:bg-gray-500 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="py-2 px-4 bg-gradient-to-r from-cyan-600 to-purple-600 text-white rounded hover:from-cyan-500 hover:to-purple-500 transition-all"
                      >
                        Submit
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Display Ads */}
            <div className="p-6 border border-cyan-800 rounded-lg bg-black/50 backdrop-blur relative overflow-hidden">
  <div className="absolute inset-0 bg-[url('/sonic-pattern.svg')] opacity-5"></div>
  <div className="relative z-10">
    <h2 className="text-xl mb-4 text-cyan-400">Sponsored Ads</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {ads.map((ad) => (
        <div
          key={ad.id}
          className="p-4 border border-cyan-800/30 rounded-lg bg-black/30 hover:bg-black/40 transition-colors"
        >
          {ad.type === "image" && (
            <img
              src={ad.contentUrl}
              alt={ad.title}
              className="w-full h-48 object-cover rounded-lg mb-4"
            />
          )}
          {ad.type === "video" && (
            <video
              src={ad.contentUrl}
              controls
              className="w-full h-48 object-cover rounded-lg mb-4"
            />
          )}
          <div className="text-sm text-cyan-400">{ad.title}</div>
          <div className="text-xs text-cyan-600">{ad.description}</div>
          <button
            onClick={() => handleAdClick(ad.id, ad.link)}
            className="w-full py-2 px-4 bg-gradient-to-r from-cyan-600 to-purple-600 text-white rounded hover:from-cyan-500 hover:to-purple-500 transition-all mt-4"
          >
            Engage
          </button>
        </div>
      ))}
    </div>
  </div>
</div>

            {txHistory.length > 0 && (
              <div className="p-6 border border-cyan-800 rounded-lg bg-black/50 backdrop-blur relative overflow-hidden mt-8">
                <div className="absolute inset-0 bg-[url('/sonic-pattern.svg')] opacity-5"></div>
                <div className="relative z-10">
                  <h2 className="text-xl mb-4 text-cyan-400">
                    Recent Transactions
                  </h2>
                  <div className="space-y-3">
                    {txHistory.map((tx, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center border-b border-cyan-800/30 pb-2"
                      >
                        <div>
                          <div className="text-sm text-cyan-500">
                            {tx.hash.slice(0, 8)}...{tx.hash.slice(-8)}
                          </div>
                          <div className="text-xs text-cyan-700">
                            {tx.date.toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-purple-400">
                            -{tx.amount} SOL
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}