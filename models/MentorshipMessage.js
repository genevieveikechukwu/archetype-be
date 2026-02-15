const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const MentorshipMessage = sequelize.define(
    "MentorshipMessage",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sender_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      receiver_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      message_text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      course_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "courses", key: "id" },
      },
      is_read: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "mentorship_messages",
      timestamps: false,
    },
  );

  return MentorshipMessage;
};
