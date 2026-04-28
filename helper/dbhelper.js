// export const executeBothDB = async ({

//   query,
//   values = [],
//   localPool,
//   awsPool,
//   type = "write", // write | read
// }) => {
//   try {
//     // 🔹 LOCAL (always primary)
//     const localResult = await localPool.query(query, values);

//     let awsResult = null;

//     // 🔹 WRITE operations (INSERT/UPDATE/DELETE)
//     if (type === "write" && awsPool) {
//       try {
//         awsResult = await awsPool.query(query, values);
//       } catch (awsErr) {
//         console.error("AWS Error:", awsErr.message);
//       }
//     }

//     // 🔹 READ operation
//     if (type === "read") {
//       return {
//         success: true,
//         data: localResult.rows,
//       };
//     }

//     return {
//       success: true,
//       local: localResult.rows[0],
//       aws: awsResult?.rows?.[0] || null,
//     };

//   } catch (err) {
//     console.error("Helper Error:", err.message);
//     throw err;
//   }
// };



import pool from "../config/db.js";

export const executeBothDB = async (query, values = []) => {
  try {
    const result = await pool.query(query, values);
    return result;
  } catch (err) {
    console.error("DB Error:", err.message);
    throw err;
  }
};