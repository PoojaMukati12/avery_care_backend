import asyncHandler from 'express-async-handler';
// Corrected import paths for models (assuming 'models' folder has camelCase names and file names like 'User.js', 'FamilyMember.js')
import FamilyMember from '../models/FamilyMember.js';
import User from '../models/user.js';
// Corrected import path for validation utilities (assuming 'utils' folder has camelCase names and file name like 'ValidationUtils.js')
import { isValidPhone, isValidGmail } from '../utils/ValidationUtils.js';

// @desc    Add a new family member
// @route   POST /api/family
// @access  Private (Authenticated User only)
// const addFamilyMember = asyncHandler(async (req, res) => {
const addFamilyMember = async (req, res) => {
	try {
		const { name, email, phoneNumber, relation } = req.body;
		const currentUserId = req.user._id;

		if (!name || !email || !phoneNumber || !relation) {
			res.status(400);
			throw new Error('Please enter all fields: name, email, phone number, and relationship for update.');
		}

		if (!isValidPhone(phoneNumber)) {
			res.status(404);
			throw new Error('Invalid phone number, Must be an Indian number with country code (+91) and 10 digits starting with 6, 7, 8, or 9.');
		}

		// Validate the format of the new email
		if (!isValidGmail(email)) {
			res.status(404);
			throw new Error('Invalid email format for family member. Only @gmail.com emails are allowed.');
		}
		const sanitizedRelation = relation.trim().toLowerCase();
		console.log("sanitizedRelation", sanitizedRelation)
		//-------------------checks exising user this same relationship ------------------------------------
		const primaryUser = await User.findById(currentUserId);
		const existingRelation = primaryUser.familyMembers.find(fm => fm.relation === sanitizedRelation);

		if (existingRelation) {
			// return res.status(200).json({ message: `A family member with relation '${sanitizedRelation}' already exists.` });
			return res.status(409).json({
				success: false,
				message: `A family member with the relation '${sanitizedRelation}' already exists.`,
			});
		}

		const [emailUser, phoneUser, emailFM, phoneFM] = await Promise.all([
			User.findOne({ email }),
			User.findOne({ phoneNumber }),
			FamilyMember.findOne({ email }),
			FamilyMember.findOne({ phoneNumber }),
		]);

		// Conflict: Same email and phone exist but in different documents (invalid pair)
		if (
			(emailUser && phoneUser && emailUser._id.toString() !== phoneUser._id.toString()) ||
			(emailFM && phoneFM && emailFM._id.toString() !== phoneFM._id.toString())
		) {
			let conflictMessage = 'Conflict: Email and phone exist but not as a valid pair.';

			if (emailUser && phoneUser && emailUser._id.toString() !== phoneUser._id.toString()) {
				conflictMessage += ' Email matched with one user and phone with another user.';
			} else if (emailUser && !phoneUser) {
				conflictMessage += ' Email matched with a user, phone did not.';
			} else if (!emailUser && phoneUser) {
				conflictMessage += ' Phone matched with a user, email did not.';
			}

			if (emailFM && phoneFM && emailFM._id.toString() !== phoneFM._id.toString()) {
				conflictMessage += ' Email matched with one family member and phone with another.';
			} else if (emailFM && !phoneFM) {
				conflictMessage += ' Email matched with a family member, phone did not.';
			} else if (!emailFM && phoneFM) {
				conflictMessage += ' Phone matched with a family member, email did not.';
			}

			if ((emailUser && phoneFM) || (phoneUser && emailFM)) {
				conflictMessage += ' Email matched with a user and phone with a family member (or vice versa).';
			}
			return res.status(409).json({ success: false, message: conflictMessage });
		}

		let existingFM = null;
		if (emailFM && phoneFM && emailFM._id.toString() === phoneFM._id.toString()) {
			existingFM = emailFM;
		}
		else if ((emailFM && phoneFM && emailFM._id.toString() !== phoneFM._id.toString()) || (emailFM || phoneFM)) {
			// Partial match or mismatched document
			return res.status(409).json({
				success: false,
				message: 'Email and phone must belong to the same family member, or both should be new.',
			});
		}

		if (existingFM) {
			if (emailUser && emailUser.email === email && emailUser.phoneNumber === phoneNumber) {
				existingFM.isUser = true
				existingFM.userId = currentUserId
				existingFM.name = emailUser.name
				existingFM.email = emailUser.email
				existingFM.phoneNumber = emailUser.phoneNumber
				await existingFM.save();
			}
			// If this FM already linked to the user, don't re-link
			if (existingFM.linkedToPrimaryUsers.includes(currentUserId)) {
				return res.status(200).json({
					success: true,
					message: 'Family member already linked to this user',
					familyMember: existingFM,
				});
			}
			// Link to current user
			existingFM.linkedToPrimaryUsers.push(currentUserId);
			await existingFM.save();

			await User.findByIdAndUpdate(currentUserId, {
				$push: {
					familyMembers: {
						relation,
						member: existingFM._id,
					},
				},
			});

			return res.status(200).json({
				success: true,
				message: 'Family member linked to your account.',
				familyMember: existingFM,
			});
		}

		// Create new family member
		const newFM = await FamilyMember.create({
			name,
			email,
			phoneNumber,
			linkedToPrimaryUsers: [currentUserId],
		});
		if (emailUser && emailUser.email === email && emailUser.phoneNumber === phoneNumber) {
			newFM.isUser = true
			newFM.userId = currentUserId
			newFM.name = emailUser.name
			newFM.email = emailUser.email
			newFM.phoneNumber = emailUser.phoneNumber
			await newFM.save();
		}

		await User.findByIdAndUpdate(currentUserId, {
			$push: {
				familyMembers: {
					relation,
					member: newFM._id,
				},
			},
		});

		return res.status(201).json({
			success: true,
			message: 'Family member created and linked.',
			familyMember: newFM,
		});
	} catch (error) {
		console.error('Add Family Member Error:', error);
		return res.status(500).json({ success: false, message: 'Server Error' });
	}
};

//get family members
const getFamilyMembers = async (req, res) => {
	try {
		const userId = req.user._id; // token se mila hua user ID (auth middleware se)

		const user = await User.findById(userId)
			.populate({
				path: 'familyMembers.member',
				select: 'name email phoneNumber', // sirf ye fields chahiye
			})
			.select('familyMembers');

		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}
		if (!user.familyMembers || user.familyMembers.length === 0) {
			return res.status(200).json({ message: 'No family members linked' });
		}
		const formattedFamily = {};

		for (let fm of user.familyMembers) {
			const relation = fm.relation;
			const member = fm.member;
			if (member) {
				formattedFamily[relation] = {
					name: member.name,
					email: member.email,
					phoneNumber: member.phoneNumber,
				};
			}
		}

		res.status(200).json(formattedFamily);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: 'Server error' });
	}
};

const updateFamilyMember = asyncHandler(async (req, res) => {

	const { familyMemberId } = req.params;
	console.log("➡️ Incoming update request for familyMemberId:", familyMemberId);
	const primaryUserId = req.user._id;
	console.log("➡️ Request from user ID:", primaryUserId);
	// Destructure all required fields from request body including 'relationship' as it is part of FamilyMember.
	const { name, phoneNumber, relationship, email } = req.body;
	console.log("📝 Incoming update data:", { name, phoneNumber, relationship, email });


	// --- Initial Input Validation for all required fields ---
	if (!name || !email || !phoneNumber || !relationship) {
		res.status(400);
		throw new Error('Please enter all fields: name, email, phone number, and relationship for update.');
	}
	console.log("📝 Incoming update data after verify:", { name, phoneNumber, relationship, email });
	// --- End Initial Input Validation ---

	// --- Check existing relation with this name ---
	const sanitizedRelation = relationship.trim().toLowerCase();
	console.log("sanitizedRelation", sanitizedRelation)
	//-------------------checks exising user this same relationship ------------------------------------
	const primaryUser = await User.findById(primaryUserId);
	console.log("user found");
	const existingRelation = primaryUser.familyMembers.find(fm => fm.relation === sanitizedRelation);
	if (existingRelation) {
		return res.status(200).json({ message: `A family member with relation '${sanitizedRelation}' already exists.` });
	}

	// Find the global family member document by ID

	console.log("👨‍👩‍👧‍👦 searching for FamilyMember in DB:", familyMemberId);
	const familyMember = await FamilyMember.findById(familyMemberId);
	console.log("👨‍👩‍👧‍👦 Found FamilyMember in DB:", familyMember);
	if (!familyMember) {
		res.status(404).json({
			message: "Family member not found"
		});
	}

	// Ensure the current user is one of the primary users linked to this global family member
	if (!familyMember.linkedToPrimaryUsers.includes(primaryUserId.toString())) {
		res.status(401);
		throw new Error('Not authorized to update this family member. You are not linked to them.');
	}

	// --- Logic: Prevent updating core fields if family member is a registered User (Option A) ---
	if (familyMember.isUser) { // Check if this FamilyMember entry is linked to a registered User
		// If linked, primary user cannot update name, email, phone number.
		// Those must be updated by the corresponding User directly.
		console.log("⚠️ This family member is a registered user. Checking if core fields are being modified...");
		if (name !== familyMember.name || email !== familyMember.email || phoneNumber !== familyMember.phoneNumber) {
			res.status(400);
			throw new Error('This family member is a registered user. Name, email, and phone number must be updated directly by them through their own user profile.');
		}
	}
	// --- End Logic ---

	// Validate the format of the new phone number
	if (!isValidPhone(phoneNumber)) {
		res.status(400);
		throw new Error('Invalid phone number, Must be an Indian number with country code (+91) and 10 digits starting with 6, 7, 8, or 9.');
	}

	// Validate the format of the new email
	if (!isValidGmail(email)) {
		res.status(400);
		throw new Error('Invalid email format for family member. Only @gmail.com emails are allowed.');
	}

	// --- Uniqueness checks for updated email/phone ---
	// If email is changing, check if the new email is already used by another global FamilyMember (excluding current FM)
	if (email !== familyMember.email) {
		const existingFamilyMemberWithNewEmail = await FamilyMember.findOne({
			email: email,
			_id: { $ne: familyMember._id }
		});
		if (existingFamilyMemberWithNewEmail) {
			res.status(400);
			console.log("📧 Email conflict check result:", existingFamilyMemberWithNewEmail);
			throw new Error('This email is already associated with another family member in the system.');
		}
	}

	// If phone number is changing, check if the new phone number is already used by another global FamilyMember (excluding current FM)
	if (phoneNumber !== familyMember.phoneNumber) {
		const existingFamilyMemberWithNewPhone = await FamilyMember.findOne({
			phoneNumber: phoneNumber,
			_id: { $ne: familyMember._id }
		});
		if (existingFamilyMemberWithNewPhone) {
			res.status(400);
			throw new Error('This phone number is already associated with another family member in the system.');
		}
		// console.log("📞 Phone conflict check result:", existingFamilyMemberWithNewPhone);
	}
	// --- End Uniqueness Checks ---


	// Update FamilyMember fields with new data
	// Note: 'name', 'email', 'phoneNumber' are only updated here if 'isUser' is false
	// or if 'isUser' is true but the fields provided are identical to the linked User (handled by previous logic)
	familyMember.name = name;
	familyMember.email = email;
	familyMember.phoneNumber = phoneNumber;
	// Save the updated FamilyMember document
	const updatedFamilyMember = await familyMember.save();
	// console.log("✅ FamilyMember successfully updated:", updatedFamilyMember);
	// Respond with a success message and the updated family member's details
	res.json({
		message: 'Family member updated successfully!',
		familyMember: {
			_id: updatedFamilyMember._id,
			name: updatedFamilyMember.name,
			email: updatedFamilyMember.email,
			phoneNumber: updatedFamilyMember.phoneNumber,
			userId: updatedFamilyMember.userId,
			linkedToPrimaryUsers: updatedFamilyMember.linkedToPrimaryUsers,
			// Relationship is specific to how the current user sees them, this is not a global property of FamilyMember document anymore.
			// This needs to be managed within the User's familyMembers array if desired.
		},
	});
});


const deleteFamilyMember = asyncHandler(async (req, res) => {
	const { familyMemberId } = req.params;
	console.log("🔍 Requested to delete family member ID:", familyMemberId);
	console.log("🔐 Request made by user ID:", req.user._id);

	// Find the global family member document by ID
	const familyMember = await FamilyMember.findById(familyMemberId);
	console.log("📄 Fetched familyMember from DB:", familyMember);

	if (!familyMember) {
		console.log("❌ Family member not found in database.");
		res.status(404);
		throw new Error('Family member not found');
	}

	// Ensure the current user is one of the primary users linked to this global family member
	const userIndex = familyMember.linkedToPrimaryUsers.findIndex(userId => userId.toString() === req.user._id.toString());

	if (userIndex === -1) { // If current user is not linked to this family member
		res.status(401);
		throw new Error('Not authorized to delete this family member from your list. You are not linked to them.');
	}

	// Remove the current user's ID from the global FamilyMember's linkedToPrimaryUsers array
	familyMember.linkedToPrimaryUsers.splice(userIndex, 1);
	await familyMember.save();
	console.log("✅ Removed user from linkedToPrimaryUsers and saved updated familyMember.");

	const user = await User.findById(req.user._id);
	console.log("👤 Loaded user document:", user?.name || "User not found");
	if (user) {
		user.familyMembers = user.familyMembers.filter((fm) => {
			return fm.member && fm.member.toString() !== familyMemberId.toString();
		});
		await user.save();
		console.log("🧹 Removed member from user's familyMembers array and saved user.");
	}
	// Optional: If no primary users are linked AND it's not a registered user, delete the FamilyMember document.
	// This is for cleanup of truly unreferenced global family member entries.
	if (familyMember.linkedToPrimaryUsers.length === 0 && !familyMember.isUser) {
		await FamilyMember.deleteOne({ _id: familyMemberId });
		console.log("🗑️ FamilyMember was unlinked and not a registered user. Deleted globally.");
		return res.json({ message: 'Family member removed from your list and globally deleted (no other links found).' });

	}

	res.json({ message: 'Family member removed from your list successfully.' });
});

export { addFamilyMember, getFamilyMembers, updateFamilyMember, deleteFamilyMember };