import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import axios from "axios";

const app = express();
const port = 3000;
env.config();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json()); 

const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});
db.connect();

app.get("/", async (req, res) => {
    const query = "SELECT * FROM notes ORDER BY id ASC";
    const result = await db.query(query);
    // console.log(result.rows);
    for (let i = 0; i < result.rows.length; i++) {
        // console.log(result.rows[i].book_isbn);
        var isbn = result.rows[i].book_isbn.trim();

        // Construct the URL
        const url = "https://openlibrary.org/api/books?bibkeys=ISBN:" + encodeURIComponent(isbn) + "&format=json&jscmd=data";
        // console.log(url);
        try {
            const response = await axios.get(url);
          
            const data = response.data[`ISBN:${isbn}`];
            // console.log(data);
            if (data) {
                var tags=data.subjects[0].name;
                for(var j=1;j<Math.min(4,data.subjects.length);j++){
                    tags+= ", "+data.subjects[j].name;
                }
                result.rows[i].tags = tags;
                result.rows[i].cover = data.cover.large || "./images.png";
                result.rows[i].pages = data.number_of_pages || "not available";
                result.rows[i].publish_date = data.publish_date || "not available";
                result.rows[i].publishers = data.publishers[0].name || "not available";
                result.rows[i].linkurl = data.url || "not available";
            } else {
                res.status(404).json({ error: "Book not found" });
            }
        } catch (error) {
            console.error("Error fetching book data:", error);
            res.status(500).json({ error: "Failed to fetch book data" });
        }
    }
    // console.log(result.rows);
    res.render("home.ejs",{
        books: result.rows,
    });

});
app.get("/addbook", (req, res) => {
    res.render("add.ejs");
});

app.post("/add", async (req, res) => {
    try{
        const query = "INSERT INTO notes (book_isbn,book_notes_date,book_rating,book_title,author) VALUES ($1, $2,$3,$4,$5)";
        await db.query(query, [req.body.isbn, req.body.start_date, req.body.rating, req.body.title, req.body.author]);
        res.redirect("/");
    }
    catch(err){
        console.log(err,"error adding book");
        console.alert("error adding book");
    }
});

app.get("/notes/view/:id", async (req, res) => {
    // Ensure that the ID is a valid integer
    const bookId = parseInt(req.params.id, 10);

    if (isNaN(bookId)) {
        return res.status(400).send("Invalid book ID.");
    }

    const query = "SELECT booknotes.id, book_notes, book_title FROM notes JOIN booknotes ON notes.id = booknotes.book_id WHERE notes.id = $1;";
    
    try {
        const result = await db.query(query, [bookId]);
        // console.log(result.rows);
        // Check if no notes were found
        if (result.rows.length === 0) {
            res.status(404).send("No notes found for the given book ID");
            console.log("No notes yet");
        } else {
            let notes = result.rows.map((row, index) => ({
                number: index + 1,
                text: row.book_notes,
                id: row.id
            }));

            // Send the data to the view
            res.render("view.ejs", { 
                book: result.rows[0],  // Assuming the book title is consistent for the whole book
                title: result.rows[0].book_title,
                notes: notes,  // Send the notes to the view
                bookid: bookId
            });
        }
    } catch (error) {
        console.error("Error fetching notes:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/notes/add/:id", async (req, res) => {
    // Ensure that the ID is a valid integer
    const bookId = parseInt(req.params.id, 10);

    if (isNaN(bookId)) {
        return res.status(400).send("Invalid book ID.");
    }

    const query = "SELECT book_title FROM notes WHERE id = $1;";
    const result = await db.query(query, [bookId]);
    // console.log(result.rows);
    if (result.rows.length === 0) {
        res.status(404).send("Book not found");
    } else {
        res.render("addnote.ejs", { book: result.rows[0].book_title ,
            id: bookId
        });
    }
});

app.post("/addnote/:id", async (req, res) => {
    const bookId = parseInt(req.params.id, 10);

    if (isNaN(bookId)) {
        return res.status(400).send("Invalid book ID.");
    }

    const query = "INSERT INTO booknotes (book_id, book_notes) VALUES ($1,$2);";
    const result = await db.query(query, [bookId, req.body.new_note]);

    res.redirect(`/notes/view/${bookId}`);
}
);

app.get("/delete/:id1/:id2", async (req, res) => {
    const noteId = parseInt(req.params.id1,10);
    const bookid = parseInt(req.params.id2, 10);

    if (isNaN(noteId)) {
        return res.status(400).send("Invalid note ID.");
    }

    const query = "DELETE FROM booknotes WHERE id = $1;";
    await db.query(query, [noteId]);

    res.redirect(`/notes/view/${bookid}`);
}
);

app.get("/edit/:id1/:id2", async (req, res) => {
    const noteId = parseInt(req.params.id1, 10);
    const bookid = parseInt(req.params.id2, 10);

    if (isNaN(noteId) || isNaN(bookid)) {
        return res.status(400).send("Invalid note or book ID.");
    }

    const query = "SELECT book_notes FROM booknotes WHERE id = $1;";
    try {
        const result = await db.query(query, [noteId]);
        // console.log(result.rows);
        if (result.rows.length === 0) {
            return res.status(404).send("Note not found");
        }

        const note = {
            id: noteId,
            text: result.rows[0].book_notes
        };

        res.render("notesedit.ejs",
             { note:note, 
                bookid:bookid });
    } catch (error) {
        console.error("Error fetching note:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.patch("/edit/:id1/:id2", async (req, res) => {
    const text = req.body.text; // Extract updated text from request body
    const noteId = parseInt(req.params.id1, 10);
    const bookId = parseInt(req.params.id2, 10);
    // console.log(text,noteId,bookId);
    if (isNaN(noteId) || isNaN(bookId)) {
        return res.status(400).send("Invalid note or book ID.");
    }

    const query = "UPDATE booknotes SET book_notes = $1 WHERE id = $2;";
    try {
        await db.query(query, [text, noteId]);
        res.status(200).json({ message: "Note updated successfully" });
    } catch (error) {
        console.error("Error updating note:", error);
        res.status(500).send("Internal Server Error");
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});